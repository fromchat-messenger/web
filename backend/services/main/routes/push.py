from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..dependencies import get_current_user, get_db
from ..models import User, PushSubscriptionRequest
from ..push_service import push_service

router = APIRouter()

@router.post("/subscribe")
async def subscribe_to_push_notifications(
    request: PushSubscriptionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Subscribe user to push notifications"""
    try:
        success = await push_service.subscribe_user(
            db=db,
            user_id=current_user.id,
            endpoint=request.endpoint,
            p256dh_key=request.keys["p256dh"],
            auth_key=request.keys["auth"]
        )
        
        if success:
            return {"status": "success", "message": "Push notifications enabled"}
        else:
            raise HTTPException(status_code=500, detail="Failed to enable push notifications")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/unsubscribe")
async def unsubscribe_from_push_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Unsubscribe user from push notifications"""
    try:
        success = await push_service.unsubscribe_user(db=db, user_id=current_user.id)
        
        if success:
            return {"status": "success", "message": "Push notifications disabled"}
        else:
            raise HTTPException(status_code=500, detail="Failed to disable push notifications")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
