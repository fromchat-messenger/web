"""Shared constants and helpers for deleted / suspended user API surface."""

from __future__ import annotations

from datetime import datetime, timezone

from .models import User
from .verification_service import VerificationStatus

DELETED_LAST_SEEN = datetime(1970, 1, 1, tzinfo=timezone.utc)


def deleted_username_for(user_id: int) -> str:
    """Placeholder username with an illegal character so it cannot be claimed."""
    return f"#deleted{user_id}"


def is_deleted_user(user: User) -> bool:
    return bool(user.deleted)


def is_suspended_user(user: User) -> bool:
    return bool(user.suspended) and not user.deleted


def is_deleted_or_suspended(user: User) -> bool:
    return is_deleted_user(user) or is_suspended_user(user)


def apply_deleted_user_db_fields(user: User) -> None:
    user.deleted = True
    user.username = deleted_username_for(user.id)
    user.display_name = ""
    user.bio = None
    user.password_hash = ""
    user.profile_picture = None
    user.last_seen = DELETED_LAST_SEEN
    user.created_at = None
    user.online = False


def deleted_user_api_fields(user_id: int) -> dict:
    """Static API fields for deleted users. Ignores all DB columns except id."""
    return {
        "username": deleted_username_for(user_id),
        "display_name": "",
        "profile_picture": None,
        "bio": None,
        "online": False,
        "last_seen": DELETED_LAST_SEEN.isoformat(),
        "created_at": None,
        "verified": False,
        "verification_status": VerificationStatus.NONE.value,
        "suspended": False,
        "suspension_reason": None,
        "deleted": True,
    }
