from datetime import datetime
from collections import defaultdict, deque
import logging
import time
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import inspect, text
import uuid
from user_agents import parse as parse_ua
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..constants import OWNER_USERNAME
from ..dependencies import get_current_user, get_current_user_allow_suspended, get_db
from ..models import LoginRequest, RegisterRequest, ChangePasswordRequest, User, CryptoPublicKey, CryptoBackup, DeviceSession
from ..utils import create_token, get_password_hash, verify_password, get_client_ip
from ..validation import is_valid_password, is_valid_username, is_valid_display_name
import os

from ..security.audit import log_security
from ..security.profanity import contains_profanity
from ..security.rate_limit import rate_limit_per_ip
from ..key_lifecycle import destroy_message_keys_for_user
router = APIRouter()
_logger = logging.getLogger(__name__)

_SERVER_INSTANCE_ID: str | None = None
_INSTANCE_ID_FILE = Path(__file__).resolve().parent.parent / ".fromchat_instance_id"


def get_server_instance_id() -> str:
    """Stable server fingerprint; UUID generated once and persisted next to the main service package."""
    global _SERVER_INSTANCE_ID
    if _SERVER_INSTANCE_ID is not None:
        return _SERVER_INSTANCE_ID
    path = _INSTANCE_ID_FILE
    try:
        if path.is_file():
            text = path.read_text(encoding="utf-8").strip()
            if text:
                _SERVER_INSTANCE_ID = text
                return _SERVER_INSTANCE_ID
    except OSError as exc:
        _logger.warning("Could not read instance id from %s: %s", path, exc)
    iid = str(uuid.uuid4())
    try:
        path.write_text(iid + "\n", encoding="utf-8")
    except OSError as exc:
        _logger.warning(
            "Could not persist instance id to %s (%s); using in-process id only.",
            path,
            exc,
        )
    _SERVER_INSTANCE_ID = iid
    return iid


_FAILED_ATTEMPT_WINDOW_SECONDS = 300
_FAILED_ATTEMPT_THRESHOLD = 5
_failed_login_attempts: dict[str, deque[float]] = defaultdict(deque)


async def _broadcast_registered_user_count_task():
    from ..db import SessionLocal
    from .messaging import messagingManager

    db = SessionLocal()
    try:
        await messagingManager.broadcast_registered_user_count(db)
    finally:
        db.close()


def _record_failed_login(identifier: str) -> bool:
    now = time.time()
    attempts = _failed_login_attempts[identifier]
    attempts.append(now)

    while attempts and now - attempts[0] > _FAILED_ATTEMPT_WINDOW_SECONDS:
        attempts.popleft()

    return len(attempts) >= _FAILED_ATTEMPT_THRESHOLD


def _reset_failed_logins(identifier: str) -> None:
    _failed_login_attempts.pop(identifier, None)

def _is_admin(user: User) -> bool:
    return user.id == 1

def convert_user(user: User) -> dict:
    return {
        "id": user.id,
        "created_at": user.created_at.isoformat(),
        "last_seen": user.last_seen.isoformat(),
        "online": user.online,
        "username": user.username,
        "display_name": user.display_name,
        "profile_picture": user.profile_picture,
        "bio": user.bio,
        "admin": _is_admin(user),
        "verified": user.verified,
        "suspended": user.suspended or False,
        "suspension_reason": user.suspension_reason,
        "deleted": (user.deleted or user.suspended) or False  # Treat suspended as deleted
    }

@router.get("/instance_id")
def get_instance_id_public():
    """Public deploy fingerprint (used when the client changes server host/port)."""
    return {"instance_id": get_server_instance_id()}


@router.get("/check_auth")
def check_auth(current_user: User = Depends(get_current_user)):
    return {
        "authenticated": True,
        "username": current_user.username,
        "admin": _is_admin(current_user)
    }


@router.post("/login")
@rate_limit_per_ip("5/minute")
def login(request: Request, login_request: LoginRequest, db: Session = Depends(get_db)):
    username = login_request.username.strip()
    client_ip = get_client_ip(request)
    raw_ua = request.headers.get("user-agent")
    import logging
    logging.getLogger("uvicorn.error").info("Login attempt start for username=%s ip=%s", username, client_ip)

    user = db.query(User).filter(User.username == username).first()
    logging.getLogger("uvicorn.error").info("Queried user from DB for username=%s -> %s", username, "FOUND" if user else "NOT FOUND")

    if not user or not verify_password(login_request.password.strip(), user.password_hash):
        log_security(
            "login_failed",
            severity="warning",
            username=username,
            ip=client_ip,
            reason="invalid_credentials",
        )
        identifiers = [f"user:{username}"]
        if client_ip:
            identifiers.append(f"ip:{client_ip}")

        suspicious = False
        for identifier in identifiers:
            if _record_failed_login(identifier):
                suspicious = True

        if suspicious:
            total_failures = {
                identifier: len(_failed_login_attempts.get(identifier, []))
                for identifier in identifiers
            }
            log_security(
                "auth_bruteforce_detected",
                severity="warning",
                username=username,
                ip=client_ip,
                failures=total_failures,
                window_seconds=_FAILED_ATTEMPT_WINDOW_SECONDS,
            )
        raise HTTPException(
            status_code=401,
            detail="Неверное имя пользователя или пароль"
        )

    # Create device session and embed into JWT
    raw_ua = request.headers.get("user-agent")
    device_name = request.headers.get("x-device-name")
    ua = parse_ua(raw_ua or "")
    session_id = uuid.uuid4().hex

    device = DeviceSession(
        user_id=user.id,
        raw_user_agent=raw_ua,
        device_name=device_name,
        device_type=("mobile" if ua.is_mobile else "tablet" if ua.is_tablet else "bot" if ua.is_bot else "desktop"),
        os_name=(ua.os.family or None),
        os_version=(ua.os.version_string or None),
        browser_name=(ua.browser.family or None),
        browser_version=(ua.browser.version_string or None),
        brand=(ua.device.brand or None),
        model=(ua.device.model or None),
        session_id=session_id,
        created_at=datetime.now(),
        last_seen=datetime.now(),
        revoked=False,
    )
    db.add(device)

    user.online = True
    user.last_seen = datetime.now()
    db.commit()
    logging.getLogger("uvicorn.error").info("Login DB commit complete for user_id=%s", user.id)

    token = create_token(user.id, user.username, session_id)

    identifiers = [f"user:{username}"]
    if client_ip:
        identifiers.append(f"ip:{client_ip}")
    for identifier in identifiers:
        _reset_failed_logins(identifier)

    log_security(
        "login_success",
        username=user.username,
        user_id=user.id,
        ip=client_ip,
        session_id=session_id,
        device=device.device_type,
        os=device.os_name,
        browser=device.browser_name,
    )

    return {
        "status": "success",
        "message": "Login successful",
        "token": token,
        "user": convert_user(user)
    }


@router.post("/register")
@rate_limit_per_ip("3/hour")
def register(
    request: Request,
    register_request: RegisterRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    username = register_request.username.strip()
    display_name = register_request.display_name.strip()
    password = register_request.password.strip()
    confirm_password = register_request.confirm_password.strip()
    client_ip = get_client_ip(request)
    raw_ua = request.headers.get("user-agent")

    # Determine if owner already exists
    owner_exists = db.query(User).filter(User.username == OWNER_USERNAME).first() is not None

    # Validate input
    if not is_valid_username(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Имя пользователя должно быть от 3 до 20 символов и содержать только английские буквы, цифры, дефисы и подчеркивания"
        )
    if contains_profanity(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Имя пользователя содержит запрещённые слова"
        )

    if not is_valid_display_name(display_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Отображаемое имя должно быть от 1 до 64 символов и не может быть пустым"
        )
    if contains_profanity(display_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Отображаемое имя содержит запрещённые слова"
        )

    if not is_valid_password(password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароль должен быть от 5 до 50 символов и не содержать пробелов"
        )

    if password != confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароли не совпадают"
        )

    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Это имя пользователя уже занято"
        )

    hashed_password = get_password_hash(password)
    
    # Set verified=True for the owner (first user to register)
    is_owner = not owner_exists and username == OWNER_USERNAME
    
    new_user = User(
        username=username,
        display_name=display_name,
        password_hash=hashed_password,
        online=True,
        last_seen=datetime.now(),
        verified=is_owner
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Create initial device session
    raw_ua = request.headers.get("user-agent")
    device_name = request.headers.get("x-device-name")
    ua = parse_ua(raw_ua or "")
    session_id = uuid.uuid4().hex
    device = DeviceSession(
        user_id=new_user.id,
        raw_user_agent=raw_ua,
        device_name=device_name,
        device_type=("mobile" if ua.is_mobile else "tablet" if ua.is_tablet else "bot" if ua.is_bot else "desktop"),
        os_name=(ua.os.family or None),
        os_version=(ua.os.version_string or None),
        browser_name=(ua.browser.family or None),
        browser_version=(ua.browser.version_string or None),
        brand=(ua.device.brand or None),
        model=(ua.device.model or None),
        session_id=session_id,
        created_at=datetime.now(),
        last_seen=datetime.now(),
        revoked=False,
    )
    db.add(device)
    db.commit()

    token = create_token(new_user.id, new_user.username, session_id)

    os_name = ua.os.family or "Unknown OS"
    if ua.os.version_string:
        os_name = f"{os_name} {ua.os.version_string}"
    browser_name = ua.browser.family or "Unknown browser"
    if ua.browser.version_string:
        browser_name = f"{browser_name} {ua.browser.version_string}"
    user_agent_summary = f"{os_name}, {browser_name}"

    log_security(
        "registration_success",
        username=new_user.username,
        display_name=new_user.display_name,
        user_id=new_user.id,
        ip=client_ip,
        user_agent=user_agent_summary,
        owner=is_owner,
    )

    background_tasks.add_task(_broadcast_registered_user_count_task)

    return {
        "status": "success",
        "message": "Регистрация прошла успешно",
        "token": token,
        "user": convert_user(new_user)
    }

@router.get("/crypto/public-key")
def get_public_key(current_user: User = Depends(get_current_user_allow_suspended), db: Session = Depends(get_db)):
    row = db.query(CryptoPublicKey).filter(CryptoPublicKey.user_id == current_user.id).first()
    return {"publicKey": row.public_key_b64 if row else None}


@router.post("/crypto/public-key")
def set_public_key(payload: dict, current_user: User = Depends(get_current_user_allow_suspended), db: Session = Depends(get_db)):
    pk = payload.get("publicKey")
    if not pk:
        raise HTTPException(status_code=400, detail="publicKey required")
    if not isinstance(pk, str) or len(pk) > 10000 or len(pk) < 10:
        raise HTTPException(status_code=400, detail="Invalid publicKey format")
    row = db.query(CryptoPublicKey).filter(CryptoPublicKey.user_id == current_user.id).first()
    if row:
        row.public_key_b64 = pk
    else:
        row = CryptoPublicKey(user_id=current_user.id, public_key_b64=pk)
        db.add(row)
    db.commit()
    return {"status": "ok"}


@router.get("/crypto/backup")
def get_backup(current_user: User = Depends(get_current_user_allow_suspended), db: Session = Depends(get_db)):
    row = db.query(CryptoBackup).filter(CryptoBackup.user_id == current_user.id).first()
    return {"blob": row.blob_json if row else None}


@router.post("/crypto/backup")
def set_backup(payload: dict, current_user: User = Depends(get_current_user_allow_suspended), db: Session = Depends(get_db)):
    blob = payload.get("blob")
    if not blob:
        raise HTTPException(status_code=400, detail="blob required")
    if not isinstance(blob, str) or len(blob) > 1000000:  # 1MB limit
        raise HTTPException(status_code=400, detail="Invalid blob format or size exceeds 1MB")
    row = db.query(CryptoBackup).filter(CryptoBackup.user_id == current_user.id).first()
    if row:
        row.blob_json = blob
    else:
        row = CryptoBackup(user_id=current_user.id, blob_json=blob)
        db.add(row)
    db.commit()
    return {"status": "ok"}


@router.delete("/admin/user/{user_id}")
def delete_user_as_owner(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only owner can delete users
    if _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Only owner can perform this action")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deleting the owner account via API
    if _is_admin(user):
        raise HTTPException(status_code=400, detail="Cannot delete owner account")

    # Manually delete user's messages to satisfy FK constraints
    from models import Message  # local import to avoid circular
    db.query(Message).filter(Message.user_id == user.id).delete()

    db.delete(user)
    db.commit()

    log_security(
        "admin_delete_user",
        severity="warning",
        actor=current_user.username,
        actor_id=current_user.id,
        target_username=user.username,
        target_id=user.id,
    )

    return {"status": "success", "deleted_user_id": user_id}

@router.get("/logout")
def logout(
    http: Request,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Revoke current session
    from utils import verify_token as _verify_token
    payload = _verify_token(credentials.credentials)
    if payload and payload.get("session_id"):
        db.query(DeviceSession).filter(
            DeviceSession.user_id == current_user.id,
            DeviceSession.session_id == payload["session_id"],
        ).update({DeviceSession.revoked: True})

    current_user.online = False
    current_user.last_seen = datetime.now()
    db.commit()

    client_ip = get_client_ip(http)
    log_security(
        "logout",
        username=current_user.username,
        user_id=current_user.id,
        ip=client_ip,
        session_id=payload.get("session_id") if payload else None,
    )

    return {
        "status": "success",
        "message": "Logged out successfully"
    }


@router.post("/change-password")
@rate_limit_per_ip("5/hour")
def change_password(
    request: Request,
    password_request: ChangePasswordRequest,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Verify current derived password against stored hash
    if not verify_password(password_request.currentPasswordDerived.strip(), current_user.password_hash):
        # 400 (not 401): mobile client treats 401 as global auth failure and clears the session.
        raise HTTPException(status_code=400, detail="Текущий пароль неверный")

    # Update password hash to hash of new derived password
    current_user.password_hash = get_password_hash(password_request.newPasswordDerived.strip())
    db.commit()

    # Optionally revoke all other sessions, keeping the current one
    if password_request.logoutAllExceptCurrent:
        from utils import verify_token as _verify_token
        payload = _verify_token(credentials.credentials)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")
        current_session_id = payload.get("session_id")
        db.query(DeviceSession).filter(
            DeviceSession.user_id == current_user.id,
            DeviceSession.session_id != current_session_id,
        ).update({DeviceSession.revoked: True})
        db.commit()

    client_ip = get_client_ip(request)
    log_security(
        "password_changed",
        username=current_user.username,
        user_id=current_user.id,
        ip=client_ip,
        logout_others=bool(password_request.logoutAllExceptCurrent),
    )

    return {"status": "success"}


@router.get("/users")
@rate_limit_per_ip("30/minute")  # Per-IP limit to prevent abuse
def list_users(request: Request, current_user: User = Depends(get_current_user_allow_suspended), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.username.asc()).all()
    return {
        "users": [
            convert_user(u) for u in users if u.id != current_user.id
        ]
    }


@router.get("/crypto/public-key/of/{user_id}")
@rate_limit_per_ip("100/minute")  # Per-IP limit to prevent abuse
def get_public_key_of(
    request: Request,
    user_id: int,
    current_user: User = Depends(get_current_user_allow_suspended),
    db: Session = Depends(get_db),
):
    row = db.query(CryptoPublicKey).filter(CryptoPublicKey.user_id == user_id).first()
    return {"publicKey": row.public_key_b64 if row else None}


@router.get("/users/search")
@rate_limit_per_ip("60/minute")  # Per-IP limit to prevent abuse
def search_users(request: Request, q: str, current_user: User = Depends(get_current_user_allow_suspended), db: Session = Depends(get_db)):
    if len(q.strip()) < 2:
        return {"users": []}
    
    # Case-insensitive partial match on username
    users = db.query(User).filter(
        User.username.ilike(f"%{q.strip()}%"),
        User.id != current_user.id  # Exclude current user
    ).order_by(User.username.asc()).limit(20).all()
    
    return {
        "users": [convert_user(u) for u in users]
    }


async def _delete_user_data(user: User, db: Session):
    """
    Helper function to delete user data - marks user as deleted, clears sensitive data,
    deletes profile picture, removes non-whitelist user data, and sends WebSocket message.
    """
    user_id = user.id
    
    # Mark user as deleted and clear sensitive data
    user.deleted = True
    user.display_name = f"Deleted User #{user_id}"
    user.bio = None
    user.password_hash = ""
    user.username = f"deleted_{user_id}"
    user.profile_picture = None
    user.last_seen = None  # Clear last seen timestamp
    user.created_at = None  # Clear member since timestamp
    
    # Delete profile picture file if exists
    if user.profile_picture and user.profile_picture.startswith("/api/profile-picture/"):
        try:
            filename = user.profile_picture.split("/")[-1]
            filepath = os.path.join("data/uploads/pfp", filename)
            if os.path.exists(filepath):
                os.remove(filepath)
        except Exception as e:
            # Log error but don't fail the request
            pass
    
    # Dynamic deletion of all non-whitelist data
    WHITELIST_TABLES = {"message", "dm_envelope", "reaction", "dm_reaction", "message_file", "dm_file"}
    
    try:
        inspector = inspect(db.bind)
        all_tables = inspector.get_table_names()
        
        for table_name in all_tables:
            if table_name in WHITELIST_TABLES or table_name == "user":
                continue
            
            # Check if table has user_id column
            columns = inspector.get_columns(table_name)
            has_user_id = any(col['name'] == 'user_id' for col in columns)
            
            if has_user_id:
                # Delete all records for this user
                db.execute(text(f"DELETE FROM {table_name} WHERE user_id = :uid"), {"uid": user_id})

        destroy_message_keys_for_user(db, user_id, commit=False)
        
        db.commit()
    except Exception as e:
        # Log error and rollback
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete user data")
    
    # Send WebSocket deletion message
    try:
        from .messaging import messagingManager
        await messagingManager.send_deletion_to_user(user_id)
    except Exception as e:
        # Log error but don't fail the request
        pass

    try:
        from .messaging import messagingManager
        await messagingManager.broadcast_registered_user_count(db)
    except Exception:
        pass


@router.post("/delete")
async def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete the current user's own account - preserves messages/DMs/reactions/files
    """
    # Prevent admin/owner account self-deletion
    if _is_admin(current_user):
        raise HTTPException(status_code=400, detail="Cannot delete admin/owner account")
    
    await _delete_user_data(current_user, db)

    log_security(
        "self_delete_account",
        severity="warning",
        user_id=current_user.id,
        username=current_user.username,
    )

    return {
        "status": "success",
        "message": "Account deleted successfully"
    }