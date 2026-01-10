from pathlib import Path
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from PIL import Image
import os
import uuid
import io
from fastapi import Request

from ..dependencies import get_db, get_current_user
from ..models import User, UpdateBioRequest, UserProfileResponse
from pydantic import BaseModel
from ..validation import is_valid_username, is_valid_display_name
from ..similarity import is_user_similar_to_verified
from .messaging import messagingManager
from ..security.audit import log_security
from ..security.profanity import contains_profanity
from ..security.rate_limit import rate_limit_per_ip

router = APIRouter()


def _ensure_owner_unsuspended(user: User | None, db: Session):
    if user and user.id == 1 and user.suspended:
        user.suspended = False
        user.suspension_reason = None
        db.commit()
        db.refresh(user)

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get current user's profile information
    """
    try:
        _ensure_owner_unsuspended(current_user, db)

        return UserProfileResponse(
            id=current_user.id,
            username=current_user.username,
            display_name=current_user.display_name,
            profile_picture=current_user.profile_picture,
            bio=current_user.bio,
            online=current_user.online,
            last_seen=current_user.last_seen,
            created_at=current_user.created_at,
            verified=current_user.verified,
            suspended=current_user.suspended or False,
            suspension_reason=current_user.suspension_reason,
            deleted=(current_user.deleted or current_user.suspended) or False,  # Treat suspended as deleted
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
    return {
        "users": [
            UserProfileResponse(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                profile_picture=user.profile_picture,
                bio=user.bio,
                online=user.online,
                last_seen=user.last_seen,
                created_at=user.created_at,
                verified=user.verified,
                suspended=user.suspended or False,
                suspension_reason=user.suspension_reason,
                deleted=(user.deleted or user.suspended) or False,  # Treat suspended as deleted
            ).model_dump()
            for user in users
        ]
    }

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
    
    return {
        "message": "Bio updated successfully",
        "bio": current_user.bio
    }


@router.get("/user/{username}")
async def get_user_by_username(
    username: str,
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
    
    # Handle deleted or suspended users
    if user.deleted or user.suspended:
        return UserProfileResponse(
            id=user.id,
            username="deleted",
            display_name="Deleted User",
            profile_picture=None,
            bio=None,
            online=False,
            last_seen=None,  # Clear last seen timestamp
            created_at=None,  # Clear member since timestamp
            verified=False,
            suspended=False,
            suspension_reason=None,
            deleted=True
        )
    
    return UserProfileResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        profile_picture=user.profile_picture,
        bio=user.bio,
        online=user.online,
        last_seen=user.last_seen,
        created_at=user.created_at,
        verified=user.verified,
        suspended=user.suspended or False,
        suspension_reason=user.suspension_reason,
        deleted=(user.deleted or user.suspended) or False,  # Treat suspended as deleted
    )

@router.get("/user/id/{user_id}")
async def get_user_by_id(
    user_id: int,
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
    
    # Handle deleted or suspended users
    if user.deleted or user.suspended:
        return UserProfileResponse(
            id=user.id,
            username="deleted",
            display_name="Deleted User",
            profile_picture=None,
            bio=None,
            online=False,
            last_seen=None,  # Clear last seen timestamp
            created_at=None,  # Clear member since timestamp
            verified=False,
            suspended=False,
            suspension_reason=None,
            deleted=True
        )
    
    return UserProfileResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        profile_picture=user.profile_picture,
        bio=user.bio,
        online=user.online,
        last_seen=user.last_seen,
        created_at=user.created_at,
        verified=user.verified,
        suspended=user.suspended or False,
        suspension_reason=user.suspension_reason,
        deleted=user.deleted or False
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
    
    log_security(
        "admin_verify_toggle",
        actor=current_user.username,
        actor_id=current_user.id,
        target_username=target_user.username,
        target_id=target_user.id,
        verified=target_user.verified,
    )

    return {
        "verified": target_user.verified,
        "message": f"User verification {'enabled' if target_user.verified else 'disabled'}"
    }


@router.get("/user/check-similarity/{user_id}")
async def check_user_similarity(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Check if a user is similar to any verified user
    """
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get all verified users
    verified_users = db.query(User).filter(User.verified == True).all()
    verified_users_data = [
        {"username": user.username, "display_name": user.display_name}
        for user in verified_users
    ]
    
    # Check similarity
    is_similar, similar_to = is_user_similar_to_verified(
        target_user.username,
        target_user.display_name,
        verified_users_data
    )
    
    return {
        "isSimilar": is_similar,
        "similarTo": similar_to if is_similar else None
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
