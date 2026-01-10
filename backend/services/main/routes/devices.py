from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..dependencies import get_current_user, get_db
from ..models import User, DeviceSession
from ..utils import verify_token
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

router = APIRouter()
security = HTTPBearer()


def _get_current_session_id(credentials: HTTPAuthorizationCredentials) -> str:
    token = credentials.credentials
    payload = verify_token(token)
    if not payload or "session_id" not in payload:
        raise HTTPException(status_code=401, detail="Invalid session")
    return payload["session_id"]


@router.get("")
def list_devices(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    current_session_id = _get_current_session_id(credentials)
    sessions = (
        db.query(DeviceSession)
        .filter(DeviceSession.user_id == current_user.id, DeviceSession.revoked == False)
        .order_by(DeviceSession.last_seen.desc())
        .all()
    )
    return {
        "devices": [
            {
                "session_id": s.session_id,
                "device_type": s.device_type,
                "device_name": s.device_name,
                "os_name": s.os_name,
                "os_version": s.os_version,
                "browser_name": s.browser_name,
                "browser_version": s.browser_version,
                "brand": s.brand,
                "model": s.model,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "last_seen": s.last_seen.isoformat() if s.last_seen else None,
                "revoked": s.revoked,
                "current": s.session_id == current_session_id,
            }
            for s in sessions
        ]
    }


@router.delete("/{session_id}")
def revoke_device(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not session_id or len(session_id) > 64 or len(session_id) < 1:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    
    s = (
        db.query(DeviceSession)
        .filter(DeviceSession.user_id == current_user.id, DeviceSession.session_id == session_id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Device session not found")
    s.revoked = True
    db.commit()
    return {"status": "success"}


@router.post("/logout-all")
def logout_all_except_current(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    current_session_id = _get_current_session_id(credentials)
    db.query(DeviceSession).filter(
        DeviceSession.user_id == current_user.id,
        DeviceSession.session_id != current_session_id,
    ).update({DeviceSession.revoked: True})
    db.commit()
    return {"status": "success"}


