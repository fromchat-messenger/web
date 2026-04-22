"""
Mint LiveKit participant JWTs for DM calls. Requires LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
and LIVEKIT_URL (WebSocket URL for clients, e.g. wss://livekit.example.com or ws://host:7880).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..dependencies import get_current_user, get_db
from ..models import User

logger = logging.getLogger("uvicorn.error")

router = APIRouter()


class LiveKitTokenRequest(BaseModel):
    peer_user_id: int = Field(..., description="The other participant (DM peer)")
    room_name: str | None = Field(
        None,
        description="Existing room from an invite; omit to create a new room",
    )


class LiveKitTokenResponse(BaseModel):
    server_url: str
    token: str
    room_name: str


def _livekit_env() -> tuple[str, str, str]:
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    server_url = os.getenv("LIVEKIT_URL", "").strip()
    if not api_key or not api_secret or not server_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit is not configured (LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL)",
        )
    return api_key, api_secret, server_url


@router.post("/token", response_model=LiveKitTokenResponse)
async def create_livekit_token(
    body: LiveKitTokenRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Issue a short-lived JWT for joining a 1:1 call room with peer_user_id.
    """
    if body.peer_user_id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="peer_user_id must differ from caller")

    peer = db.query(User).filter(User.id == body.peer_user_id).first()
    if not peer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Peer user not found")

    api_key, api_secret, server_url = _livekit_env()

    if body.room_name and body.room_name.strip():
        room_name = body.room_name.strip()
    else:
        room_name = f"call-{uuid.uuid4().hex}"

    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError as e:
        logger.exception("livekit-api not installed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LiveKit SDK unavailable on server",
        ) from e

    grants = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )

    token = (
        AccessToken(api_key, api_secret)
        .with_identity(str(user.id))
        .with_name(user.username or str(user.id))
        .with_ttl(timedelta(hours=1))
        .with_grants(grants)
    )

    jwt_token = token.to_jwt()

    return LiveKitTokenResponse(server_url=server_url, token=jwt_token, room_name=room_name)
