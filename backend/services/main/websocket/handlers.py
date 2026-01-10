from datetime import datetime
import json
import logging
import time
from typing import Any
from fastapi import HTTPException, WebSocket, Request
from sqlalchemy.orm import Session

from .registry import WebSocketHandlerRegistry
from ..routes.messaging import (
    MessaggingSocketManager,
    _send_message_internal,
    _edit_message_internal,
    get_messages,
    edit_message,
    delete_message,
    add_reaction,
    add_dm_reaction,
)
from ..models import (
    User,
    SendMessageRequest,
    EditMessageRequest,
    DMEnvelope,
    ReactionRequest,
    DMReactionRequest,
    UpdateLog,
)
from ..security.audit import log_access, log_dm

logger = logging.getLogger("uvicorn.error")

# Create global registry instance
handler_registry = WebSocketHandlerRegistry()

# Create decorator alias
websocket_handler = handler_registry.register


def log(manager: MessaggingSocketManager, websocket: WebSocket, user: User | None, event: str, **extra: Any) -> None:
    """Log WebSocket event."""
    ws_path = getattr(getattr(websocket, "url", None), "path", None)
    if not ws_path and isinstance(getattr(websocket, "scope", None), dict):
        ws_path = websocket.scope.get("path")
    ws_path = ws_path or "unknown"
    headers = {}
    if isinstance(getattr(websocket, "scope", None), dict):
        headers = {k.decode("latin1"): v.decode("latin1") for k, v in websocket.scope.get("headers", [])}
    xff = headers.get("x-forwarded-for")
    client_ip = xff.split(",")[0].strip() if xff else (websocket.client.host if websocket.client else None)
    
    log_access(
        "ws_event",
        path=ws_path,
        event=event,
        user=user.username if user else None,
        user_id=user.id if user else None,
        ip=client_ip,
        **extra,
    )


@websocket_handler("getUpdates", authRequired=True)
async def getUpdates(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Handle gap detection - client requests updates from a specific sequence number."""
    last_seq = data.get("lastSeq", 0)
    manager.last_seq_by_ws[websocket] = last_seq
    current_seq = manager.sequence_numbers.get(user.id, 0)
    
    # Query database for missed updates
    missed_updates = []
    if last_seq > 0 and last_seq < current_seq:
        try:
            # Get all updates between last_seq and current_seq
            update_logs = db.query(UpdateLog).filter(
                UpdateLog.user_id == user.id,
                UpdateLog.sequence > last_seq,
                UpdateLog.sequence <= current_seq
            ).order_by(UpdateLog.sequence.asc()).all()
            
            # Each log entry contains a batch of updates with the same sequence number
            for log_entry in update_logs:
                updates = json.loads(log_entry.updates)
                missed_updates.append({
                    "seq": log_entry.sequence,
                    "updates": updates
                })
        except Exception as e:
            logger.error(f"Failed to retrieve missed updates: {e}")
    
    # Send missed updates directly (not through return value)
    for batch in missed_updates:
        await websocket.send_json({
            "type": "updates",
            "seq": batch["seq"],
            "updates": batch["updates"]
        })
    
    # Update the websocket's last sequence tracking
    manager.last_seq_by_ws[websocket] = current_seq
    log(manager, websocket, user, "getUpdates", last_seq=last_seq, current_seq=current_seq, missed_count=len(missed_updates))
    
    return {
        "status": "ok",
        "lastSeq": current_seq,
        "missedCount": len(missed_updates)
    }


@websocket_handler("ping", authRequired=True)
async def ping(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Handle ping - authenticate and set user online."""
    # Set user online in DB
    user.online = True
    user.last_seen = datetime.now()
    db.commit()
    # Add to online users
    manager.online_users.add(user.id)
    # Broadcast status change
    await manager.broadcast_status_change(user.id, True, user.last_seen.isoformat(), db)
    
    log(manager, websocket, user, "ping")
    return {"status": "success"}


@websocket_handler("getMessages", authRequired=True)
async def getMessages(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Get all public chat messages."""
    result = await get_messages(user, db)
    log(manager, websocket, user, "getMessages")
    return result


@websocket_handler("sendMessage", authRequired=True)
async def sendMessage(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Send a public chat message."""
    message_request: SendMessageRequest = SendMessageRequest.model_validate(data)
    
    # Call internal function directly (rate limiting is handled at infrastructure level via Caddy)
    response = await _send_message_internal(message_request, user, db, [])
    await manager.broadcast({
        "type": "newMessage",
        "data": response["message"]
    }, db)
    
    log(manager, websocket, user, "sendMessage", message_id=response["message"]["id"])
    return response


@websocket_handler("dmSend", authRequired=True)
async def dmSend(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Send a direct message using the new envelope encryption format."""
    payload = data
    required = ["recipientId", "iv_b64", "ciphertext_b64", "wrapped_mek_b64"]
    for key in required:
        if key not in payload:
            raise HTTPException(status_code=400, detail=f"Missing {key}")

    env = DMEnvelope(
        sender_id=user.id,
        recipient_id=int(payload["recipientId"]),
        iv_b64=payload["iv_b64"],
        ciphertext_b64=payload["ciphertext_b64"],
        sender_wrapped_mek_b64=payload["wrapped_mek_b64"],  # Client sends their own MEK
        recipient_wrapped_mek_b64=payload["wrapped_mek_b64"],  # For simplicity, store same MEK
        compliance_wrapped_mek_b64=payload.get("compliance_wrapped_mek_b64"),
        reply_to_id=payload.get("replyToId") if isinstance(payload.get("replyToId"), int) else None,
    )
    db.add(env)
    db.commit()
    db.refresh(env)
    
    # Send user-specific WebSocket updates (each user gets only their MEK)
    base_payload = {
        "id": env.id,
        "senderId": env.sender_id,
        "recipientId": env.recipient_id,
        "iv_b64": env.iv_b64,
        "ciphertext_b64": env.ciphertext_b64,
        "timestamp": env.timestamp.isoformat(),
        "replyToId": env.reply_to_id,
    }

    # Send to recipient with their MEK
    recipient_payload = {
        "type": "dmNew",
        "data": {
            **base_payload,
            "wrapped_mek_b64": env.recipient_wrapped_mek_b64,
        }
    }
    await manager.send_update_to_user(env.recipient_id, "dmNew", recipient_payload["data"], db)

    # Send to sender with their MEK
    sender_payload = {
        "type": "dmNew",
        "data": {
            **base_payload,
            "wrapped_mek_b64": env.sender_wrapped_mek_b64,
        }
    }
    await manager.send_update_to_user(env.sender_id, "dmNew", sender_payload["data"], db)

    # Send push notification for DM
    try:
        from ..push_service import push_service
        await push_service.send_dm_notification(db, env, user)
    except Exception as e:
        logger.error(f"Failed to send push notification for DM {env.id}: {e}")
    
    log(manager, websocket, user, "dmSend", dm_envelope_id=env.id, recipient_id=env.recipient_id)
    log_dm(
        "message_sent_ws",
        dm_envelope_id=env.id,
        sender_id=user.id,
        sender_username=user.username,
        recipient_id=env.recipient_id,
        reply_to=env.reply_to_id,
    )
    
    return {"status": "ok", "id": env.id}


@websocket_handler("editMessage", authRequired=True)
async def editMessage(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Edit a public chat message."""
    
    message_id = data["message_id"]
    edit_request: EditMessageRequest = EditMessageRequest.model_validate(data)
    
    response = await _edit_message_internal(message_id, edit_request, user, db)
    await manager.broadcast({
        "type": "messageEdited",
        "data": response["message"]
    }, db)
    
    log(manager, websocket, user, "editMessage", message_id=message_id)
    return response


@websocket_handler("dmEdit", authRequired=True)
async def dmEdit(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Edit a direct message."""
    payload = data
    env_id = int(payload["id"])
    env: DMEnvelope | None = db.query(DMEnvelope).filter(DMEnvelope.id == env_id).first()
    if not env:
        raise HTTPException(status_code=404, detail="DM not found")
    if env.sender_id != user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")
    
    # Replace ciphertext and iv
    env.iv_b64 = payload["iv"]
    env.ciphertext_b64 = payload["ciphertext"]
    env.sender_wrapped_mek_b64 = payload.get("wrappedMk", "")
    env.recipient_wrapped_mek_b64 = payload.get("wrappedMk", "")
    db.commit()
    db.refresh(env)

    # Send user-specific payloads for edit
    base_payload = {
        "id": env.id,
        "senderId": env.sender_id,
        "recipientId": env.recipient_id,
        "iv_b64": env.iv_b64,
        "ciphertext_b64": env.ciphertext_b64,
        "timestamp": env.timestamp.isoformat(),
    }

    # Send to recipient with their MEK
    recipient_payload = {
        "type": "dmEdited",
        "data": {
            **base_payload,
            "wrapped_mek_b64": env.recipient_wrapped_mek_b64,
        }
    }
    await manager.send_update_to_user(env.recipient_id, "dmEdited", recipient_payload["data"], db)

    # Send to sender with their MEK
    sender_payload = {
        "type": "dmEdited",
        "data": {
            **base_payload,
            "wrapped_mek_b64": env.sender_wrapped_mek_b64,
        }
    }
    await manager.send_update_to_user(env.sender_id, "dmEdited", sender_payload["data"], db)
    
    log(manager, websocket, user, "dmEdit", dm_envelope_id=env.id)
    log_dm(
        "message_edited",
        dm_envelope_id=env.id,
        user_id=user.id,
        username=user.username,
    )
    
    return {"status": "ok", "id": env.id}


@websocket_handler("dmDelete", authRequired=True)
async def dmDelete(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Delete a direct message."""
    payload = data
    env_id = int(payload["id"])
    env: DMEnvelope | None = db.query(DMEnvelope).filter(DMEnvelope.id == env_id).first()
    if not env:
        raise HTTPException(status_code=404, detail="DM not found")
    if env.sender_id != user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    
    db.delete(env)
    db.commit()
    
    payload_ws = {
        "type": "dmDeleted",
        "data": {
            "id": env_id,
            "senderId": user.id,
            "recipientId": payload.get("recipientId")
        }
    }
    await manager.send_update_to_user(env.recipient_id, "dmDeleted", payload_ws["data"], db)
    await manager.send_update_to_user(env.sender_id, "dmDeleted", payload_ws["data"], db)
    
    log(manager, websocket, user, "dmDelete", dm_envelope_id=env_id)
    log_dm(
        "message_deleted",
        dm_envelope_id=env_id,
        user_id=user.id,
        username=user.username,
        recipient_id=env.recipient_id,
    )
    
    return {"status": "ok", "id": env_id}


@websocket_handler("deleteMessage", authRequired=True)
async def deleteMessage(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Delete a public chat message."""
    message_id = data["message_id"]
    response = await delete_message(message_id, user, db)
    await manager.broadcast({
        "type": "messageDeleted",
        "data": {"message_id": message_id}
    }, db)
    
    log(manager, websocket, user, "deleteMessage", message_id=message_id)
    return response


@websocket_handler("addReaction", authRequired=True)
async def addReaction(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Add or remove a reaction to a public chat message."""
    reaction_request = ReactionRequest(
        message_id=data["message_id"],
        emoji=data["emoji"]
    )
    
    response = await add_reaction(reaction_request, user, db)
    
    # Broadcast reaction update
    await manager.broadcast({
        "type": "reactionUpdate",
        "data": {
            "message_id": data["message_id"],
            "emoji": data["emoji"],
            "action": response["action"],
            "user_id": user.id,
            "username": user.username,
            "reactions": response["reactions"]
        }
    }, db)
    
    log(manager, websocket, user, "addReaction", message_id=data["message_id"], emoji=data["emoji"], action=response["action"])
    return response


@websocket_handler("addDmReaction", authRequired=True)
async def addDmReaction(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Add or remove a reaction to a direct message."""
    reaction_request = DMReactionRequest(
        dm_envelope_id=data["dm_envelope_id"],
        emoji=data["emoji"]
    )
    
    response = await add_dm_reaction(reaction_request, user, db)
    
    # Broadcast reaction update
    await manager.broadcast({
        "type": "dmReactionUpdate",
        "data": {
            "dm_envelope_id": data["dm_envelope_id"],
            "emoji": data["emoji"],
            "action": response["action"],
            "user_id": user.id,
            "username": user.username,
            "reactions": response["reactions"]
        }
    }, db)
    
    log(manager, websocket, user, "addDmReaction", dm_envelope_id=data["dm_envelope_id"], emoji=data["emoji"], action=response["action"])
    return response


@websocket_handler("call_signaling", authRequired=True)
async def call_signaling(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Forward WebRTC signaling between peers."""
    payload = data or {}
    to_user_id = int(payload.get("toUserId") or 0)
    if not to_user_id:
        raise HTTPException(status_code=400, detail="Missing toUserId")
    
    # Ensure sender is set by the server
    payload["fromUserId"] = user.id
    payload["fromUsername"] = user.username
    
    await manager.send_to_user(to_user_id, {
        "type": "call_signaling",
        "data": payload
    })
    
    log(manager, websocket, user, "call_signaling", to_user_id=to_user_id)
    return {"status": "ok"}


@websocket_handler("call_video_toggle", authRequired=True)
async def call_video_toggle(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Forward video toggle state between peers."""
    payload = data or {}
    to_user_id = int(payload.get("toUserId") or 0)
    if not to_user_id:
        raise HTTPException(status_code=400, detail="Missing toUserId")
    
    await manager.send_update_to_user(to_user_id, "call_signaling", {
        "type": "call_video_toggle",
        "fromUserId": user.id,
        "toUserId": to_user_id,
        "data": {"enabled": payload.get("enabled", False)}
    }, db)
    
    log(manager, websocket, user, "call_video_toggle", to_user_id=to_user_id, enabled=payload.get("enabled", False))
    return {"status": "ok"}


@websocket_handler("call_screen_share_toggle", authRequired=True)
async def call_screen_share_toggle(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Forward screen share toggle state between peers."""
    payload = data or {}
    to_user_id = int(payload.get("toUserId") or 0)
    if not to_user_id:
        raise HTTPException(status_code=400, detail="Missing toUserId")
    
    await manager.send_update_to_user(to_user_id, "call_signaling", {
        "type": "call_screen_share_toggle",
        "fromUserId": user.id,
        "toUserId": to_user_id,
        "data": {"enabled": payload.get("enabled", False)}
    }, db)
    
    log(manager, websocket, user, "call_screen_share_toggle", to_user_id=to_user_id, enabled=payload.get("enabled", False))
    return {"status": "ok"}


@websocket_handler("subscribeStatus", authRequired=True)
async def subscribeStatus(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Subscribe to status updates for a user."""
    user_id_to_subscribe = int(data["userId"])
    manager.ws_subscriptions[websocket].add(user_id_to_subscribe)
    
    # Get current status of the user
    target_user = db.query(User).filter(User.id == user_id_to_subscribe).first()
    if target_user:
        # Send current status directly (not through return value)
        await websocket.send_json({
            "type": "statusUpdate",
            "data": {
                "userId": user_id_to_subscribe,
                "online": target_user.online,
                "lastSeen": target_user.last_seen.isoformat() if target_user.last_seen else None
            }
        })
        log(manager, websocket, user, "subscribeStatus", target_user_id=user_id_to_subscribe)
        return {"status": "ok"}
    else:
        log(manager, websocket, user, "subscribeStatus_error", target_user_id=user_id_to_subscribe, error="User not found")
        raise HTTPException(status_code=404, detail="User not found")


@websocket_handler("unsubscribeStatus", authRequired=True)
async def unsubscribeStatus(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> dict | None:
    """Unsubscribe from status updates for a user."""
    user_id_to_unsubscribe = int(data["userId"])
    manager.ws_subscriptions[websocket].discard(user_id_to_unsubscribe)
    
    log(manager, websocket, user, "unsubscribeStatus", target_user_id=user_id_to_unsubscribe)
    return {"status": "ok"}


@websocket_handler("typing", authRequired=True)
async def typing(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> None:
    """Handle typing indicator start for public chat."""
    was_typing = manager.typing_state.get(user.id, False)
    manager.typing_users[user.id] = time.time()
    
    # Only send update if state changed (started typing)
    if not was_typing:
        manager.typing_state[user.id] = True
        # Broadcast to all connected users
        await manager.broadcast({
            "type": "typing",
            "data": {
                "userId": user.id,
                "username": user.username
            }
        }, db)
    
    # No confirmation response - privacy protection


@websocket_handler("stopTyping", authRequired=True)
async def stopTyping(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> None:
    """Handle typing indicator stop for public chat."""
    was_typing = manager.typing_state.get(user.id, False)
    if user.id in manager.typing_users:
        del manager.typing_users[user.id]
    
    # Only send update if state changed (stopped typing)
    if was_typing:
        manager.typing_state[user.id] = False
        # Broadcast to all connected users
        await manager.broadcast({
            "type": "stopTyping",
            "data": {
                "userId": user.id,
                "username": user.username
            }
        }, db)
    
    # No confirmation response - privacy protection
    log(manager, websocket, user, "stopTyping")


@websocket_handler("dmTyping", authRequired=True)
async def dmTyping(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> None:
    """Handle typing indicator start for DM."""
    recipient_id = int(data["recipientId"])
    
    if user.id not in manager.dm_typing_users:
        manager.dm_typing_users[user.id] = {}
    if user.id not in manager.dm_typing_state:
        manager.dm_typing_state[user.id] = {}
    
    was_typing = manager.dm_typing_state[user.id].get(recipient_id, False)
    manager.dm_typing_users[user.id][recipient_id] = time.time()
    
    # Only send update if state changed (started typing)
    if not was_typing:
        manager.dm_typing_state[user.id][recipient_id] = True
        # Send only to recipient
        await manager.send_update_to_user(recipient_id, "dmTyping", {
            "userId": user.id,
            "username": user.username
        }, db)
    
    # No confirmation response - privacy protection


@websocket_handler("stopDmTyping", authRequired=True)
async def stopDmTyping(manager: MessaggingSocketManager, websocket: WebSocket, db: Session, user: User, data: dict) -> None:
    """Handle typing indicator stop for DM."""
    recipient_id = int(data["recipientId"])
    
    was_typing = False
    if user.id in manager.dm_typing_state:
        was_typing = manager.dm_typing_state[user.id].get(recipient_id, False)
    
    if user.id in manager.dm_typing_users and recipient_id in manager.dm_typing_users[user.id]:
        del manager.dm_typing_users[user.id][recipient_id]
        if not manager.dm_typing_users[user.id]:
            del manager.dm_typing_users[user.id]
    
    # Only send update if state changed (stopped typing)
    if was_typing:
        if user.id in manager.dm_typing_state:
            manager.dm_typing_state[user.id][recipient_id] = False
        # Send only to recipient
        await manager.send_update_to_user(recipient_id, "stopDmTyping", {
            "userId": user.id,
            "username": user.username
        }, db)
    
    # No confirmation response - privacy protection

