from pathlib import Path
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from PIL import Image
import os
import uuid
import io
from fastapi import Request

from ..dependencies import get_current_user, get_current_user_allow_suspended, get_db
from ..presence_service import presence_service
from ..models import User, UpdateBioRequest, UserProfileResponse
from pydantic import BaseModel
from ..validation import is_valid_username, is_valid_display_name
from ..verification_service import (
    VerificationStatus,
    compute_verification_status,
    get_verified_users_data,
)
from .messaging import messagingManager
from ..security.audit import log_security
from ..security.profanity import contains_profanity
from ..security.rate_limit import rate_limit_per_ip
from ..deleted_user import DELETED_LAST_SEEN, deleted_user_api_fields, is_deleted_user

logger = logging.getLogger("uvicorn.error")

router = APIRouter()


def _build_user_profile_response(
    user: User,
    is_owner_request: bool = False,
    *,
    verified_users_data: list[dict[str, str]] | None = None,
) -> UserProfileResponse:
    should_hide_profile = (not is_owner_request) and is_deleted_user(user)
    if not should_hide_profile:
        online, last_seen = presence_service.get_presence(user.id)
        verification_status = (
            compute_verification_status(user, verified_users_data)
            if verified_users_data is not None
            else (
                VerificationStatus.VERIFIED
                if user.verified
                else VerificationStatus.NONE
            )
        )
        return UserProfileResponse(
            id=user.id,
            username=user.username,
            display_name=user.display_name or user.username,
            profile_picture=user.profile_picture,
            bio=user.bio,
            online=online,
            last_seen=last_seen,
            created_at=user.created_at,
            verified=bool(user.verified),
            verification_status=verification_status.value,
            suspended=bool(user.suspended),
            suspension_reason=user.suspension_reason,
            deleted=bool(user.deleted),
        )

    hidden = deleted_user_api_fields(user.id)
    return UserProfileResponse(
        id=user.id,
        username=hidden["username"],
        display_name=hidden["display_name"],
        profile_picture=hidden["profile_picture"],
        bio=hidden["bio"],
        online=hidden["online"],
        last_seen=DELETED_LAST_SEEN,
        created_at=hidden["created_at"],
        verified=hidden["verified"],
        verification_status=hidden["verification_status"],
        suspended=hidden["suspended"],
        suspension_reason=hidden["suspension_reason"],
        deleted=hidden["deleted"],
    )


def _ensure_owner_unsuspended(user: User | None, db: Session):
    if user and user.id == 1 and user.suspended:
        user.suspended = False
        user.suspension_reason = None
        db.commit()
        db.refresh(user)


async def broadcast_profile_update(user: User, db: Session) -> None:
    """Notify clients subscribed to this user that their public profile changed."""
    try:
        payload = build_profile_update_payload(user, viewer_id=None, db=db)
        subscriber_count = sum(
            1
            for ws, subs in messagingManager.ws_subscriptions.items()
            if user.id in subs
        )
        logger.info(
            "broadcast_profile_update user_id=%s bio=%r subscribers=%s",
            user.id,
            user.bio,
            subscriber_count,
        )
        await messagingManager.broadcast_profile_update(user.id, payload, db)
    except Exception:
        pass


def build_profile_update_payload(
    user: User,
    viewer_id: int | None,
    db: Session,
) -> dict:
    verified_users_data = get_verified_users_data(db)
    is_owner_request = viewer_id is not None and (viewer_id == user.id or viewer_id == 1)
    return _build_user_profile_response(
        user,
        is_owner_request=is_owner_request,
        verified_users_data=verified_users_data,
    ).model_dump(mode="json")

# Request models
class UpdateProfileRequest(BaseModel):
    username: str | None = None
    display_name: str | None = None
    description: str | None = None

# Create uploads directory if it doesn't exist
PROFILE_PICTURES_DIR = Path("data/uploads/pfp")

os.makedirs(PROFILE_PICTURES_DIR, exist_ok=True)

@router.post("/upload-profile-picture")
@rate_limit_per_ip("10/minute")
async def upload_profile_picture(
    request: Request,
    profile_picture: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload and process a profile picture
    """
    # Validate file type
    if not profile_picture.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Validate file size (max 5MB)
    if profile_picture.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be less than 5MB")
    
    try:
        # Read and process the image
        image_data = await profile_picture.read()
        
        # Open image with PIL
        image = Image.open(io.BytesIO(image_data))
        
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Resize to a reasonable size (200x200)
        image.thumbnail((200, 200), Image.Resampling.LANCZOS)
        
        # Generate unique filename
        filename = f"{current_user.id}_{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(PROFILE_PICTURES_DIR, filename)
        
        # Save the processed image
        image.save(filepath, 'JPEG', quality=85)
        
        # Update user's profile picture in database
        profile_picture_url = f"/api/profile-picture/{filename}"
        current_user.profile_picture = profile_picture_url
        db.commit()
        db.refresh(current_user)

        await broadcast_profile_update(current_user, db)

        return {
            "message": "Profile picture uploaded successfully",
            "profile_picture_url": profile_picture_url
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")

@router.get("/profile-picture/{filename}")
async def get_profile_picture(filename: str):
    """
    Serve profile picture files
    """

    if not re.match(r"^\d+_[0-9a-z]+\.jpg$", filename):
        raise HTTPException(status_code=400, detail="Invalid file name")

    filepath = os.path.join(PROFILE_PICTURES_DIR, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Profile picture not found")
    
    return FileResponse(filepath, media_type="image/jpeg")

@router.get("/user/profile")
async def get_user_profile(
    current_user: User = Depends(get_current_user_allow_suspended),
    db: Session = Depends(get_db)
):
    """
    Get current user's profile information
    """
    try:
        _ensure_owner_unsuspended(current_user, db)

        online, last_seen = presence_service.get_presence(current_user.id)
        verified_users_data = get_verified_users_data(db)
        verification_status = compute_verification_status(current_user, verified_users_data)
        return UserProfileResponse(
            id=current_user.id,
            username=current_user.username,
            display_name=current_user.display_name,
            profile_picture=current_user.profile_picture,
            bio=current_user.bio,
            online=online,
            last_seen=last_seen,
            created_at=current_user.created_at,
            verified=current_user.verified,
            verification_status=verification_status.value,
            suspended=current_user.suspended or False,
            suspension_reason=current_user.suspension_reason,
            deleted=current_user.deleted or False,
        )
    except Exception as e:
        # Log and return a consistent HTTP 500 error with minimal details
        try:
            import logging
            logging.getLogger("uvicorn.error").exception("Error in get_user_profile: %s", e)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/user/list")
async def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.id != 1:
        raise HTTPException(status_code=403, detail="Only admin can list users")

    _ensure_owner_unsuspended(current_user, db)

    users = db.query(User).order_by(User.username.asc()).all()
    verified_users_data = get_verified_users_data(db)
    profile_items = []
    for user in users:
        online, last_seen = presence_service.get_presence(user.id)
        verification_status = compute_verification_status(user, verified_users_data)
        profile_items.append(
            UserProfileResponse(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                profile_picture=user.profile_picture,
                bio=user.bio,
                online=online,
                last_seen=last_seen,
                created_at=user.created_at,
                verified=user.verified,
                verification_status=verification_status.value,
                suspended=user.suspended or False,
                suspension_reason=user.suspension_reason,
                deleted=user.deleted or False,
            ).model_dump()
        )
    return {"users": profile_items}

@router.put("/user/profile")
@rate_limit_per_ip("10/minute")
async def update_user_profile(
    request: Request,
    update_request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update current user's profile information
    """
    updated = False
    
    # Update username if provided
    if update_request.username is not None:
        username = update_request.username.strip()
        if not is_valid_username(username):
            raise HTTPException(
                status_code=400, 
                detail="Имя пользователя должно быть от 3 до 20 символов и содержать только английские буквы, цифры, дефисы и подчеркивания"
            )
        if contains_profanity(username):
            raise HTTPException(
                status_code=400,
                detail="Имя пользователя содержит запрещённые слова"
            )
        
        # Check if username is already taken by another user
        existing_user = db.query(User).filter(User.username == username, User.id != current_user.id).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Это имя пользователя уже занято")
        
        current_user.username = username
        updated = True
    
    # Update display name if provided
    if update_request.display_name is not None:
        display_name = update_request.display_name.strip()
        if not is_valid_display_name(display_name):
            raise HTTPException(
                status_code=400, 
                detail="Отображаемое имя должно быть от 1 до 64 символов и не может быть пустым"
            )
        if contains_profanity(display_name):
            raise HTTPException(
                status_code=400,
                detail="Отображаемое имя содержит запрещённые слова"
            )
        
        current_user.display_name = display_name
        updated = True
    
    # Update bio if provided
    if update_request.description is not None:
        bio = update_request.description.strip()
        if len(bio) > 500:
            raise HTTPException(status_code=400, detail="Bio must be 500 characters or less")
        
        current_user.bio = bio
        updated = True
    
    if updated:
        db.commit()
        db.refresh(current_user)
        await broadcast_profile_update(current_user, db)
        return {
            "message": "Profile updated successfully",
            "username": current_user.username,
            "display_name": current_user.display_name,
            "bio": current_user.bio
        }
    else:
        return {
            "message": "No changes made",
            "username": current_user.username,
            "display_name": current_user.display_name,
            "bio": current_user.bio
        }


@router.put("/user/bio")
@rate_limit_per_ip("10/minute")
async def update_user_bio(
    request: Request,
    bio_request: UpdateBioRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update current user's bio
    """
    if len(bio_request.bio) > 500:  # Limit bio to 500 characters
        raise HTTPException(status_code=400, detail="Bio must be 500 characters or less")
    
    current_user.bio = bio_request.bio.strip()
    db.commit()
    db.refresh(current_user)

    await broadcast_profile_update(current_user, db)

    return {
        "message": "Bio updated successfully",
        "bio": current_user.bio
    }


@router.get("/user/stats/registered-count")
def get_registered_user_count(
    current_user: User = Depends(get_current_user_allow_suspended),
    db: Session = Depends(get_db),
):
    """Number of registered accounts (non-deleted users)."""
    n = db.query(User).filter(User.deleted.is_(False)).count()
    return {"count": n}


@router.get("/user/{username}")
async def get_user_by_username(
    username: str,
    current_user: User = Depends(get_current_user_allow_suspended),
    db: Session = Depends(get_db)
):
    """
    Get user profile by username
    """
    if not username or not is_valid_username(username):
        raise HTTPException(status_code=400, detail="Invalid username format")
    
    user = db.query(User).filter(User.username == username).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    _ensure_owner_unsuspended(user, db)
    
    is_owner_request = current_user.id == user.id or current_user.id == 1
    verified_users_data = get_verified_users_data(db)
    return _build_user_profile_response(
        user,
        is_owner_request=is_owner_request,
        verified_users_data=verified_users_data,
    )

@router.get("/user/id/{user_id}")
async def get_user_by_id(
    user_id: int,
    current_user: User = Depends(get_current_user_allow_suspended),
    db: Session = Depends(get_db)
):
    """
    Get user profile by user ID
    """
    if user_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    _ensure_owner_unsuspended(user, db)
    
    is_owner_request = current_user.id == user.id or current_user.id == 1
    verified_users_data = get_verified_users_data(db)
    return _build_user_profile_response(
        user,
        is_owner_request=is_owner_request,
        verified_users_data=verified_users_data,
    )


@router.post("/user/{user_id}/verify")
async def verify_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Toggle verification status for a user (owner only)
    """
    # Only user with ID 1 (owner) can verify users
    if current_user.id != 1:
        raise HTTPException(status_code=403, detail="Only owner can verify users")
    
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Toggle verification status
    target_user.verified = not target_user.verified
    db.commit()
    
    verified_users_data = get_verified_users_data(db)
    verification_status = compute_verification_status(target_user, verified_users_data)
    
    log_security(
        "admin_verify_toggle",
        actor=current_user.username,
        actor_id=current_user.id,
        target_username=target_user.username,
        target_id=target_user.id,
        verified=target_user.verified,
    )

    await broadcast_profile_update(target_user, db)

    return {
        "verified": target_user.verified,
        "verification_status": verification_status.value,
        "message": f"User verification {'enabled' if target_user.verified else 'disabled'}"
    }


# Admin endpoints for user management
class SuspendUserRequest(BaseModel):
    reason: str

@router.post("/user/{user_id}/suspend")
async def suspend_user(
    user_id: int,
    request: SuspendUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Suspend a user account (admin only)
    """
    # Only user with ID 1 (admin) can suspend users
    if current_user.id != 1:
        raise HTTPException(status_code=403, detail="Only admin can suspend users")
    
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Cannot suspend admin
    if target_user.id == 1:
        raise HTTPException(status_code=400, detail="Cannot suspend admin account")
    
    # Suspend the user
    target_user.suspended = True
    target_user.suspension_reason = request.reason
    db.commit()
    
    log_security(
        "admin_suspend_user",
        actor=current_user.username,
        actor_id=current_user.id,
        target_username=target_user.username,
        target_id=target_user.id,
        reason=request.reason,
    )

    # Send WebSocket suspension message
    try:
        await messagingManager.send_suspension_to_user(user_id, request.reason)
    except Exception as e:
        # Log error but don't fail the request
        pass
    
    return {
        "status": "success",
        "message": f"User {target_user.username} has been suspended",
        "reason": request.reason
    }


@router.post("/user/{user_id}/unsuspend")
async def unsuspend_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Unsuspend a user account (admin only)
    """
    # Only user with ID 1 (admin) can unsuspend users
    if current_user.id != 1:
        raise HTTPException(status_code=403, detail="Only admin can unsuspend users")
    
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Unsuspend the user
    target_user.suspended = False
    target_user.suspension_reason = None
    db.commit()

    # Send WebSocket unsuspension message
    try:
        await messagingManager.send_unsuspension_to_user(user_id)
    except Exception:
        # Log error but don't fail the request
        pass
    
    log_security(
        "admin_unsuspend_user",
        actor=current_user.username,
        actor_id=current_user.id,
        target_username=target_user.username,
        target_id=target_user.id,
    )

    return {
        "status": "success",
        "message": f"User {target_user.username} has been unsuspended"
    }


@router.post("/user/{user_id}/delete")
async def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a user account (admin only) - preserves messages/DMs/reactions/files
    """
    # Only user with ID 1 (admin) can delete users
    if current_user.id != 1:
        raise HTTPException(status_code=403, detail="Only admin can delete users")
    
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Cannot delete admin
    if target_user.id == 1:
        raise HTTPException(status_code=400, detail="Cannot delete admin account")
    
    snapshot_username = target_user.username
    snapshot_display_name = target_user.display_name

    from .account import _delete_user_data
    await _delete_user_data(target_user, db)
    
    log_security(
        "admin_delete_user",
        severity="warning",
        actor=current_user.username,
        actor_id=current_user.id,
        target_username=snapshot_username,
        target_display_name=snapshot_display_name,
        target_id=target_user.id,
    )

    return {
        "status": "success",
        "message": f"User {target_user.username} has been deleted"
    }
