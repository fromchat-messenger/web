"""
Envelope encryption API endpoints for private messaging.

Handles:
- Sending encrypted private messages (proxies to messaging service)
- Retrieving encrypted conversations
- Decrypting messages with proper MEK unwrapping
- Managing transport public key distribution
"""

import logging
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ..db import get_db
from ..models import User, DMEnvelope, DMFile, DMEditHistory, EditMessageRequest
from ..dependencies import get_current_user
from ..security.audit import log_security
from ..service_calls import (
    get_messaging_transport_public_key,
    get_compliance_public_key,
    process_message_with_files_in_messaging_service,
    store_encrypted_file,
    init_resumable_upload_in_storage,
    get_resumable_upload_status_in_storage,
    upload_resumable_chunk_in_storage,
    complete_resumable_upload_in_storage,
    get_resumable_upload_data_in_storage,
    delete_resumable_upload_in_storage,
)
from .messaging import messagingManager, convert_dm_envelope

logger = logging.getLogger("uvicorn.error")


def _compliance_public_key_required() -> bool:
    try:
        from services.shared.message_retention import get_message_retention
    except ImportError:
        from backend.services.shared.message_retention import get_message_retention  # type: ignore
    return not get_message_retention().never_store_compliance_mek()


router = APIRouter(prefix="/dm", tags=["Direct Messages"])


# ============================================================================
# Pydantic Models
# ============================================================================

class FileModel(BaseModel):
    encrypted_file_data_b64: str
    filename: str
    file_size: int


class SendEncryptedMessageRequest(BaseModel):
    """Request to send an encrypted message."""
    recipient_id: int
    client_public_key_b64: str
    transport_nonce_b64: str
    transport_ciphertext_b64: str
    sender_public_key_b64: str
    recipient_public_key_b64: str
    client_message_id: Optional[str] = None
    reply_to_id: Optional[int] = None
    files: list[FileModel] = Field(default_factory=list, alias="transport_files")
    uploaded_file_ids: list[str] = Field(default_factory=list, alias="uploaded_file_ids")

    class Config:
        allow_population_by_field_name = True


class EditEncryptedMessageRequest(BaseModel):
    """Request to edit an encrypted message."""
    client_public_key_b64: str
    transport_nonce_b64: str
    transport_ciphertext_b64: str
    sender_public_key_b64: str
    recipient_public_key_b64: str


class InitResumableUploadRequest(BaseModel):
    filename: str
    total_size: int
    recipient_id: int
    chunk_size: Optional[int] = None


class UploadChunkRequest(BaseModel):
    offset: int
    data_b64: str


# ============================================================================
# Key Management Endpoint
# ============================================================================

@router.get("/key/transport/public")
async def get_transport_public_key_endpoint(request: Request):
    """
    Get the current messaging service ephemeral transport public key.

    Clients use this key to encrypt their messages with X25519 + ChaCha20-Poly1305.

    Returns:
        {
            "key_id": "key-identifier",
            "public_key_b64": "base64-encoded-key",
            "created_at": "unix-timestamp"
        }
    """
    client_ip = getattr(request.client, 'host', 'unknown') if request.client else 'unknown'

    try:
        result = await get_messaging_transport_public_key()
        return result
    except Exception as e:
        logger.error("Failed to fetch transport public key: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch encryption key"
        )


@router.post("/upload/init")
async def init_resumable_upload(
    request: InitResumableUploadRequest,
    current_user: User = Depends(get_current_user),
):
    if request.total_size <= 0:
        raise HTTPException(status_code=400, detail="total_size must be > 0")

    if current_user.id == request.recipient_id:
        raise HTTPException(status_code=400, detail="Cannot send files to yourself")

    payload = await init_resumable_upload_in_storage(
        filename=request.filename,
        total_size=request.total_size,
        allowed_user_ids=[current_user.id, request.recipient_id],
        chunk_size=request.chunk_size,
    )
    return payload


@router.get("/upload/{upload_id}")
async def get_resumable_upload_status(
    upload_id: str,
    current_user: User = Depends(get_current_user),
):
    return await get_resumable_upload_status_in_storage(upload_id, current_user.id)


@router.patch("/upload/{upload_id}")
async def upload_resumable_chunk(
    upload_id: str,
    request: UploadChunkRequest,
    current_user: User = Depends(get_current_user),
):
    return await upload_resumable_chunk_in_storage(
        upload_id=upload_id,
        user_id=current_user.id,
        offset=request.offset,
        data_b64=request.data_b64,
    )


@router.post("/upload/{upload_id}/complete")
async def complete_resumable_upload(
    upload_id: str,
    current_user: User = Depends(get_current_user),
):
    return await complete_resumable_upload_in_storage(upload_id, current_user.id)


@router.delete("/upload/{upload_id}")
async def delete_resumable_upload(
    upload_id: str,
    current_user: User = Depends(get_current_user),
):
    return await delete_resumable_upload_in_storage(upload_id, current_user.id)




# ============================================================================
# Message Sending Endpoint
# ============================================================================

@router.post("/send")
async def send_encrypted_message(
    request: SendEncryptedMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Send an encrypted private message using envelope encryption.
    
    Flow:
    1. Client encrypts plaintext with transport public key (X25519 + ChaCha20)
    2. Sends encrypted message to this endpoint with public keys
    3. Main backend forwards to messaging service for envelope encryption processing
    4. Messaging service returns encrypted message + 3 wrapped MEKs
    5. Main backend stores in database
    
    Args:
        request: SendEncryptedMessageRequest
        current_user: Current authenticated user
        db: Database session
    
    Returns:
        {
            "id": message-id,
            "sender_id": sender-user-id,
            "recipient_id": recipient-user-id,
            "timestamp": iso-timestamp,
            "reply_to_id": optional-reply-id
        }
    """
    try:
        # Verify recipient exists
        recipient = db.query(User).filter(User.id == request.recipient_id).first()
        if not recipient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Recipient not found"
            )

        # Verify not sending to self
        if current_user.id == request.recipient_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot send messages to yourself"
            )

        # Fetch compliance public key and process through messaging service
        compliance_key_response = await get_compliance_public_key()
        compliance_public_key_b64 = compliance_key_response.get("public_key_b64") or ""
        if _compliance_public_key_required() and not compliance_public_key_b64:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve compliance key"
            )

        all_transport_files: list[dict[str, object]] = [
            {
                "encrypted_file_data_b64": f.encrypted_file_data_b64,
                "filename": f.filename,
                "file_size": f.file_size,
            }
            for f in request.files
        ]

        for upload_id in request.uploaded_file_ids:
            uploaded_payload = await get_resumable_upload_data_in_storage(upload_id, current_user.id)
            all_transport_files.append(
                {
                    "encrypted_file_data_b64": uploaded_payload["encrypted_file_data_b64"],
                    "filename": uploaded_payload["filename"],
                    "file_size": uploaded_payload["file_size"],
                    "upload_id": upload_id,
                }
            )

        processed = await process_message_with_files_in_messaging_service(
            client_public_key_b64=request.client_public_key_b64,
            transport_nonce_b64=request.transport_nonce_b64,
            transport_ciphertext_b64=request.transport_ciphertext_b64,
            compliance_public_key_b64=compliance_public_key_b64,
            sender_public_key_b64=request.sender_public_key_b64,
            recipient_public_key_b64=request.recipient_public_key_b64,
            transport_files=[
                {
                    "encrypted_file_data_b64": str(f["encrypted_file_data_b64"]),
                    "filename": str(f.get("filename", "file")),
                }
                for f in all_transport_files
            ],
        )

        logger.info(
            "Processed encrypted message, storing in database sender_id=%s recipient_id=%s",
            current_user.id,
            request.recipient_id,
        )

        msg = processed["message"]
        dm_envelope = DMEnvelope(
            sender_id=current_user.id,
            recipient_id=request.recipient_id,
            iv_b64=msg["nonce"],
            ciphertext_b64=msg["ciphertext"],
            sender_wrapped_mek_b64=processed["sender_wrapped_mek"],
            recipient_wrapped_mek_b64=processed["recipient_wrapped_mek"],
            compliance_wrapped_mek_b64=processed["compliance_wrapped_mek"],
            reply_to_id=request.reply_to_id,
        )

        db.add(dm_envelope)
        db.commit()
        db.refresh(dm_envelope)

        # Store files encrypted with the SAME MEK as the message.
        # We persist per-file nonce (for AES-GCM) but do not persist per-file wrapped MEKs.
        try:
            file_results: list[dict] = processed.get("files", []) or []
            if len(file_results) != len(all_transport_files):
                raise HTTPException(status_code=500, detail="File processing count mismatch")

            for i, tf in enumerate(all_transport_files):
                fr = file_results[i]
                file_storage_result = await store_encrypted_file(
                    encrypted_file_data_b64=fr["ciphertext"],
                    filename=str(tf["filename"]),
                    content_type="application/octet-stream",
                    sender_id=current_user.id,
                    recipient_id=request.recipient_id,
                )

                df = DMFile(
                    message_id=dm_envelope.id,
                    sender_id=current_user.id,
                    recipient_id=dm_envelope.recipient_id,
                    path=file_storage_result.get("path") or f"/uploads/files/encrypted/{file_storage_result['file_id']}",
                    name=Path(str(tf["filename"])).name,
                    nonce_b64=fr["nonce"],
                )
                db.add(df)
            db.commit()

            for upload_id in request.uploaded_file_ids:
                try:
                    await delete_resumable_upload_in_storage(upload_id, current_user.id)
                except Exception as cleanup_error:
                    logger.warning("Failed to cleanup resumable upload %s: %s", upload_id, cleanup_error)

        except HTTPException:
            raise
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
            raise
        logger.info(
            "Stored encrypted message msg_id=%s from user_id=%s to user_id=%s",
            dm_envelope.id,
            current_user.id,
            request.recipient_id,
        )

        # Send user-specific WebSocket updates (each user gets only their MEK and files metadata)
        recipient_payload = convert_dm_envelope(db, dm_envelope, dm_envelope.recipient_id)
        await messagingManager.send_update_to_user(dm_envelope.recipient_id, "dmNew", recipient_payload, db)

        sender_payload = convert_dm_envelope(db, dm_envelope, dm_envelope.sender_id)
        if request.client_message_id:
            sender_payload["client_message_id"] = request.client_message_id
        await messagingManager.send_update_to_user(dm_envelope.sender_id, "dmNew", sender_payload, db)

        return {
            "id": dm_envelope.id,
            "sender_id": dm_envelope.sender_id,
            "recipient_id": dm_envelope.recipient_id,
            "timestamp": dm_envelope.timestamp.isoformat(),
            "client_message_id": request.client_message_id,
            "reply_to_id": dm_envelope.reply_to_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error sending encrypted message: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send message"
        )


# ============================================================================
# Compliance Endpoint (User ID 1 Only)
# ============================================================================

@router.get("/compliance/extract/{message_id}")
async def extract_message_for_compliance(
    message_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Extract message data for compliance review.

    RESTRICTED: Only accessible by user ID 1 (compliance officer).
    This endpoint extracts encrypted message data that can be transferred
    to an air-gapped machine for decryption using the compliance private key.
    """
    # Log compliance access attempt
    client_ip = getattr(request.client, 'host', 'unknown') if request.client else 'unknown'
    log_security("compliance_access_attempt", "warning",
                 username=current_user.username, user_id=current_user.id,
                 message_id=message_id, ip=client_ip)

    # Security check: only user ID 1 can access this
    if current_user.id != 1:
        log_security("compliance_access_denied", "error",
                     username=current_user.username, user_id=current_user.id,
                     message_id=message_id, ip=client_ip,
                     reason="Unauthorized user (compliance officer access required)")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This endpoint is restricted to compliance officers."
        )

    # Find the message
    envelope = db.query(DMEnvelope).filter(DMEnvelope.id == message_id).first()
    if not envelope:
        log_security("compliance_access_failed", "warning",
                     username=current_user.username, user_id=current_user.id,
                     message_id=message_id, ip=client_ip,
                     reason="Message not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )

    # Get sender and recipient usernames for logging
    sender = db.query(User).filter(User.id == envelope.sender_id).first()
    recipient = db.query(User).filter(User.id == envelope.recipient_id).first()
    sender_username = sender.username if sender else f"user_{envelope.sender_id}"
    recipient_username = recipient.username if recipient else f"user_{envelope.recipient_id}"

    # Extract compliance-relevant data (excluding sensitive server-only fields)
    files = []
    try:
        for f in (envelope.files or []):
            wrapped = envelope.compliance_wrapped_mek_b64

            files.append(
                {
                    "id": f.id,
                    "name": f.name,
                    "path": f.path,
                    "wrapped_mek_b64": wrapped,
                    "nonce_b64": getattr(f, "nonce_b64", None),
                }
            )
    except Exception:
        files = []

    # Get complete edit history for compliance
    edit_history = db.query(DMEditHistory).filter(
        DMEditHistory.message_id == message_id
    ).order_by(DMEditHistory.edited_at).all()

    edit_history_data = []
    for edit_entry in edit_history:
        edited_by_user = db.query(User).filter(User.id == edit_entry.edited_by).first()
        edit_history_data.append({
            "edit_id": edit_entry.id,
            "edited_at": edit_entry.edited_at.isoformat(),
            "edited_by_user_id": edit_entry.edited_by,
            "edited_by_username": edited_by_user.username if edited_by_user else "unknown",
            "previous_ciphertext_b64": edit_entry.previous_ciphertext_b64,
            "previous_iv_b64": edit_entry.previous_iv_b64,
            "previous_compliance_wrapped_mek_b64": edit_entry.previous_compliance_wrapped_mek_b64,
        })

    compliance_data = {
        "message_id": envelope.id,
        "sender_id": envelope.sender_id,
        "recipient_id": envelope.recipient_id,
        "timestamp": envelope.timestamp.isoformat(),
        "iv_b64": envelope.iv_b64,
        "ciphertext_b64": envelope.ciphertext_b64,
        "compliance_wrapped_mek_b64": envelope.compliance_wrapped_mek_b64,
        "files": files,
        "edit_history": edit_history_data,
        "total_edits": len(edit_history_data),
        "extraction_timestamp": datetime.now().isoformat(),
        "extracted_by_user_id": current_user.id,
        "compliance_system_ready": envelope.compliance_wrapped_mek_b64 is not None
    }

    log_security("compliance_extraction_success", "info",
                 username=current_user.username, user_id=current_user.id,
                 message_id=message_id, sender_id=envelope.sender_id,
                 recipient_id=envelope.recipient_id, sender_username=sender_username,
                 recipient_username=recipient_username, ip=client_ip)

    return {
        "status": "success",
        "message": "Message data extracted for compliance review",
        "data": compliance_data,
        "instructions": [
            "Transfer this data to an air-gapped machine",
            "Use scripts/compliance/decryption/main.py decrypt --input-file <json_file>",
            "Keep the compliance private key offline at all times"
        ]
    }


# ============================================================================
# Conversation Retrieval Endpoint
# ============================================================================

@router.get("/conversation/{other_user_id}")
async def get_encrypted_conversation(
    other_user_id: int,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieve encrypted conversation with another user.
    
    Returns messages with the wrapped MEK that the current user can unwrap.
    Each user receives only their own wrapped MEK version.
    
    Args:
        other_user_id: ID of the other user in conversation
        limit: Max messages to return (default 50)
        offset: Pagination offset (default 0)
        current_user: Current authenticated user
        db: Database session
    
    Returns:
        List of encrypted messages with metadata:
        [
            {
                "id": message-id,
                "sender_id": sender-id,
                "recipient_id": recipient-id,
                "nonce": base64-encoded-nonce,
                "ciphertext": base64-encoded-ciphertext,
                "wrapped_mek": wrapped-mek-for-current-user,
                "timestamp": iso-timestamp,
                "reply_to_id": optional-id,
                "is_edited": boolean
            },
            ...
        ]
    """
    try:
        # Verify other user exists
        other_user = db.query(User).filter(User.id == other_user_id).first()
        if not other_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        # Fetch messages in both directions, sorted by timestamp (exclude deleted)
        messages = (
            db.query(DMEnvelope)
            .filter(
                (
                    (DMEnvelope.sender_id == current_user.id)
                    & (DMEnvelope.recipient_id == other_user_id)
                )
                | (
                    (DMEnvelope.sender_id == other_user_id)
                    & (DMEnvelope.recipient_id == current_user.id)
                ),
                DMEnvelope.deleted_at.is_(None)  # Exclude soft-deleted messages
            )
            .order_by(DMEnvelope.timestamp.desc())
            .limit(limit)
            .offset(offset)
            .all()
        )

        result = []
        for msg in reversed(messages):
            # Select wrapped MEK appropriate for current user
            if msg.sender_id == current_user.id:
                wrapped_mek = msg.sender_wrapped_mek_b64
            else:
                wrapped_mek = msg.recipient_wrapped_mek_b64

            result.append(
                {
                    "id": msg.id,
                    "sender_id": msg.sender_id,
                    "recipient_id": msg.recipient_id,
                    "nonce": msg.iv_b64,
                    "ciphertext": msg.ciphertext_b64,
                    "wrapped_mek": wrapped_mek,
                    "timestamp": msg.timestamp.isoformat(),
                    "reply_to_id": msg.reply_to_id,
                    "is_edited": msg.is_edited,
                }
            )

        logger.info(
            "Retrieved %d messages for conversation between user_id=%s and user_id=%s",
            len(result),
            current_user.id,
            other_user_id,
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error fetching conversation: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch conversation"
        )


# ============================================================================
# Message Deletion Endpoint
# ============================================================================

@router.get("/owner/compliance-view")
async def get_owner_compliance_view(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get all encrypted messages accessible to the owner (user_id 1) for compliance.
    
    This endpoint returns all DM envelopes with their compliance-wrapped MEKs.
    Only accessible to the system owner for audit/compliance purposes.
    
    Returns:
        List of all encrypted messages with compliance_wrapped_mek:
        [
            {
                "id": message-id,
                "sender_id": sender-id,
                "recipient_id": recipient-id,
                "nonce": base64-encoded-nonce,
                "ciphertext": base64-encoded-ciphertext,
                "compliance_wrapped_mek": wrapped-mek-for-compliance,
                "timestamp": iso-timestamp,
            },
            ...
        ]
    """
    if current_user.id != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owner (user_id 1) can access compliance view"
        )

    try:
        # Fetch all non-deleted messages
        messages = (
            db.query(DMEnvelope)
            .filter(DMEnvelope.deleted_at.is_(None))  # Exclude soft-deleted messages
            .order_by(DMEnvelope.timestamp.desc())
            .all()
        )

        result = []
        for msg in messages:
            result.append(
                {
                    "id": msg.id,
                    "sender_id": msg.sender_id,
                    "recipient_id": msg.recipient_id,
                    "nonce": msg.iv_b64,
                    "ciphertext": msg.ciphertext_b64,
                    "compliance_wrapped_mek": msg.compliance_wrapped_mek_b64,
                    "timestamp": msg.timestamp.isoformat(),
                }
            )

        logger.info(
            "Owner retrieved %d messages for compliance view",
            len(result),
        )

        return result

    except Exception as e:
        logger.exception("Error retrieving compliance view: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve compliance view"
        )


@router.get("/compliance/edit-history/dm/{message_id}")
async def get_dm_edit_history_for_compliance(
    message_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get complete edit history for a DM message (compliance access only).

    RESTRICTED: Only accessible by user ID 1 (compliance officer).
    This endpoint returns the full edit history for a DM message,
    including all previous encrypted versions.

    Args:
        message_id: ID of the DM message
        current_user: Current authenticated user (must be user_id 1)
        db: Database session

    Returns:
        Complete edit history for the message
    """
    client_ip = getattr(request.client, 'host', 'unknown') if request.client else 'unknown'

    # Log compliance access attempt
    log_security("dm_edit_history_access_attempt", "warning",
                user_id=current_user.id,
                username=current_user.username,
                ip=client_ip,
                message_id=message_id)

    # Only user_id 1 (compliance officer) can access
    if current_user.id != 1:
        log_security("dm_edit_history_access_denied", "error",
                    user_id=current_user.id,
                    username=current_user.username,
                    ip=client_ip,
                    reason="Unauthorized user (compliance officer access required)")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This endpoint is restricted to compliance officers."
        )

    try:
        # Get the original message
        message = db.query(DMEnvelope).filter(DMEnvelope.id == message_id).first()
        if not message:
            log_security("dm_edit_history_access_failed", "warning",
                        user_id=current_user.id,
                        ip=client_ip,
                        message_id=message_id,
                        reason="Message not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found"
            )

        # Get edit history
        edit_history = db.query(DMEditHistory).filter(
            DMEditHistory.message_id == message_id
        ).order_by(DMEditHistory.edited_at).all()

        # Convert to response format
        history_entries = []
        for entry in edit_history:
            edited_by_user = db.query(User).filter(User.id == entry.edited_by).first()
            history_entries.append({
                "id": entry.id,
                "dm_envelope_id": entry.message_id,
                "previous_ciphertext_b64": entry.previous_ciphertext_b64,
                "previous_iv_b64": entry.previous_iv_b64,
                "previous_compliance_wrapped_mek_b64": entry.previous_compliance_wrapped_mek_b64,
                "edited_at": entry.edited_at.isoformat(),
                "edited_by_username": edited_by_user.username if edited_by_user else "unknown",
                "edited_by_user_id": entry.edited_by
            })

        # Current message data
        current_data = {
            "id": message.id,
            "sender_id": message.sender_id,
            "recipient_id": message.recipient_id,
            "ciphertext_b64": message.ciphertext_b64,
            "iv_b64": message.iv_b64,
            "sender_wrapped_mek_b64": message.sender_wrapped_mek_b64,
            "recipient_wrapped_mek_b64": message.recipient_wrapped_mek_b64,
            "compliance_wrapped_mek_b64": message.compliance_wrapped_mek_b64,
            "timestamp": message.timestamp.isoformat(),
            "is_edited": message.is_edited
        }

        result = {
            "message_id": message_id,
            "current_version": current_data,
            "edit_history": history_entries,
            "total_edits": len(history_entries)
        }

        log_security("dm_edit_history_access_success", "info",
                    user_id=current_user.id,
                    username=current_user.username,
                    ip=client_ip,
                    message_id=message_id,
                    edit_count=len(history_entries))

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error retrieving DM edit history: %s", e)
        log_security("dm_edit_history_access_error", "error",
                    user_id=current_user.id,
                    ip=client_ip,
                    message_id=message_id,
                    error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve edit history"
        )


@router.put("/edit/{message_id}")
async def edit_encrypted_message(
    message_id: int,
    request: EditEncryptedMessageRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Edit an encrypted private message.

    This endpoint allows users to edit their own DM messages. The edit history
    is stored in compliance storage, but users only see the latest version.
    The message goes through the same envelope encryption process as sending.

    Args:
        message_id: ID of the message to edit
        request: Edit request with transport-encrypted content
        current_user: Current authenticated user
        db: Database session

    Returns:
        Updated message info
    """
    try:
        # Find the message
        msg = db.query(DMEnvelope).filter(
            DMEnvelope.id == message_id,
            DMEnvelope.deleted_at.is_(None)  # Can't edit deleted messages
        ).first()
        if not msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found"
            )

        # Verify ownership
        if msg.sender_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot edit others' messages"
            )

        # Fetch compliance public key and process through messaging service
        compliance_key_response = await get_compliance_public_key()
        compliance_public_key_b64 = compliance_key_response.get("public_key_b64") or ""
        if _compliance_public_key_required() and not compliance_public_key_b64:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve compliance key"
            )

        # Process the transport-encrypted message through envelope encryption
        processed = await process_message_with_files_in_messaging_service(
            client_public_key_b64=request.client_public_key_b64,
            transport_nonce_b64=request.transport_nonce_b64,
            transport_ciphertext_b64=request.transport_ciphertext_b64,
            compliance_public_key_b64=compliance_public_key_b64,
            sender_public_key_b64=request.sender_public_key_b64,
            recipient_public_key_b64=request.recipient_public_key_b64,
            transport_files=[],  # No file support for edits currently
        )

        # Update the message with new processed content (commit first so edit always succeeds)
        processed_msg = processed["message"]
        prev_ciphertext = msg.ciphertext_b64
        prev_iv = msg.iv_b64
        prev_wrapped_mek = msg.compliance_wrapped_mek_b64 or ""
        msg.ciphertext_b64 = processed_msg["ciphertext"]
        msg.iv_b64 = processed_msg["nonce"]
        msg.sender_wrapped_mek_b64 = processed["sender_wrapped_mek"]
        msg.recipient_wrapped_mek_b64 = processed["recipient_wrapped_mek"]
        msg.compliance_wrapped_mek_b64 = processed["compliance_wrapped_mek"]
        msg.is_edited = True

        db.commit()
        db.refresh(msg)

        # Best-effort: store edit history for compliance (table may not exist yet)
        try:
            edit_history = DMEditHistory(
                message_id=msg.id,
                dm_envelope_id=msg.id,
                previous_ciphertext_b64=prev_ciphertext,
                previous_iv_b64=prev_iv,
                previous_compliance_wrapped_mek_b64=prev_wrapped_mek,
                edited_by=current_user.id,
                edited_by_user_id=current_user.id,
            )
            db.add(edit_history)
            db.commit()
        except Exception as history_err:
            db.rollback()
            logger.warning(
                "Could not store DM edit history (table dm_edit_history may not exist): %s",
                history_err,
            )

        logger.info(
            "Edited encrypted message msg_id=%s by user_id=%s",
            message_id,
            current_user.id
        )

        # Send WebSocket updates to both sender and recipient
        recipient_payload = convert_dm_envelope(db, msg, msg.recipient_id)
        await messagingManager.send_update_to_user(msg.recipient_id, "dmEdited", recipient_payload, db)

        sender_payload = convert_dm_envelope(db, msg, msg.sender_id)
        await messagingManager.send_update_to_user(msg.sender_id, "dmEdited", sender_payload, db)

        return {
            "id": msg.id,
            "sender_id": msg.sender_id,
            "recipient_id": msg.recipient_id,
            "timestamp": msg.timestamp.isoformat(),
            "is_edited": msg.is_edited
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error editing encrypted message: %s", e)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to edit message"
        )


@router.delete("/{message_id}")
async def delete_encrypted_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Delete an encrypted message (soft delete).
    
    Only the sender can delete their own messages.
    In the compliance system, keys are automatically destroyed after deletion.
    
    Args:
        message_id: ID of message to delete
        current_user: Current authenticated user
        db: Database session
    
    Returns:
        {"status": "deleted", "message_id": message-id}
    """
    try:
        msg = db.query(DMEnvelope).filter(DMEnvelope.id == message_id).first()
        if not msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found"
            )

        # Only sender can delete
        if msg.sender_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot delete others' messages"
            )

        # Soft delete: set deleted_at timestamp instead of hard delete
        from datetime import datetime
        msg.deleted_at = datetime.now()
        db.commit()

        logger.info(
            "Deleted encrypted message msg_id=%s by user_id=%s",
            message_id,
            current_user.id
        )

        return {"status": "deleted", "message_id": message_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error deleting message: %s", e)
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete message"
        )
