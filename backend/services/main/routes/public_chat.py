from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..dependencies import get_current_user_allow_suspended, get_db
from ..models import PublicChatProfileResponse, User
from ..public_chat_config import load_public_chat_static_profile

router = APIRouter()


@router.get("/public-chat/profile", response_model=PublicChatProfileResponse)
def get_public_chat_profile(
    current_user: User = Depends(get_current_user_allow_suspended),
    db: Session = Depends(get_db),
):
    """Metadata for the instance public chat (title, bio, member count)."""
    del current_user
    try:
        static_profile = load_public_chat_static_profile()
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Public chat profile is not configured") from exc

    member_count = db.query(User).filter(User.deleted.is_(False)).count()
    bio = static_profile["bio"].strip() or None

    return PublicChatProfileResponse(
        id=static_profile["id"],
        title=static_profile["title"],
        bio=bio,
        member_count=member_count,
    )
