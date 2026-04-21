from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .utils import verify_token
from .models import User, DeviceSession
from .db import SessionLocal
import logging

security = HTTPBearer()
logger = logging.getLogger("uvicorn.error")

# Зависимость для получения сессии БД
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Internal dependency helper to reuse auth/session resolution
def _get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials,
    db: Session,
    allow_suspended: bool = False,
) -> User:
    token = credentials.credentials
    try:
        payload = verify_token(token)
    except Exception as e:
        logger.warning("get_current_user: token verification error: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not payload:
        logger.info("get_current_user: verify_token returned empty payload")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == payload["user_id"]).first()
    if not user:
        logger.info("get_current_user: user not found for user_id=%s", payload.get("user_id"))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.id == 1 and user.suspended:
        user.suspended = False
        user.suspension_reason = None
        db.commit()
        db.refresh(user)

    # Validate device session from JWT
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session",
            headers={"WWW-Authenticate": "Bearer"},
        )

    device_session = (
        db.query(DeviceSession)
        .filter(DeviceSession.user_id == user.id, DeviceSession.session_id == session_id)
        .first()
    )

    if not device_session or device_session.revoked:
        logger.info("get_current_user: session missing/revoked for user_id=%s session_id=%s", user.id, session_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session revoked or not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if session has been inactive for too long (sliding expiration)
    from .constants import TOKEN_INACTIVITY_EXPIRE_HOURS
    inactivity_threshold = datetime.now() - timedelta(hours=TOKEN_INACTIVITY_EXPIRE_HOURS)
    if device_session.last_seen < inactivity_threshold:
        # Session expired due to inactivity - revoke it
        device_session.revoked = True
        db.commit()
        logger.info("get_current_user: session expired due to inactivity for user_id=%s session_id=%s", user.id, session_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired due to inactivity",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Touch last_seen on valid session (sliding expiration - extends token life)
    device_session.last_seen = datetime.now()
    db.commit()

    # Check if user is suspended
    if user.suspended and not allow_suspended:
        logger.info("get_current_user: account suspended for user_id=%s reason=%s", user.id, user.suspension_reason)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended",
            headers={"suspension_reason": user.suspension_reason or "No reason provided"},
        )

    # Check if user is deleted
    if user.deleted:
        logger.info("get_current_user: account deleted for user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account deleted",
        )

    request.state.current_user = user
    request.state.session_id = session_id

    return user


# Dependency for all standard routes: suspended users are blocked
def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    return _get_current_user(request, credentials, db, allow_suspended=False)


# Dependency for read/crypto endpoints that remain accessible for suspended users
def get_current_user_allow_suspended(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    return _get_current_user(request, credentials, db, allow_suspended=True)