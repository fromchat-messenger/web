"""Server-side verification status computation."""

from enum import Enum

from sqlalchemy.orm import Session

from .models import User
from .similarity import is_user_similar_to_verified


class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    WARNING = "warning"
    BLOCKED = "blocked"
    NONE = "none"


def get_verified_users_data(db: Session) -> list[dict[str, str]]:
    verified_users = (
        db.query(User)
        .filter(
            User.verified.is_(True),
            User.deleted.is_(False),
            User.suspended.is_(False),
        )
        .all()
    )
    return [
        {"username": user.username, "display_name": user.display_name}
        for user in verified_users
    ]


def compute_verification_status(
    user: User,
    verified_users_data: list[dict[str, str]],
) -> VerificationStatus:
    if user.deleted:
        return VerificationStatus.NONE
    if user.suspended:
        return VerificationStatus.BLOCKED
    if user.verified:
        return VerificationStatus.VERIFIED

    is_similar, _ = is_user_similar_to_verified(
        user.username,
        user.display_name,
        verified_users_data,
    )
    return VerificationStatus.WARNING if is_similar else VerificationStatus.NONE
