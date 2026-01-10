from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List

from ..constants import OWNER_USERNAME
from ..dependencies import get_current_user
from ..models import User
from ..security.audit import log_security
from ..security.profanity import add_to_blocklist, get_blocklist, remove_from_blocklist
from ..security.rate_limit import reset_rate_limit_for_ip, clear_all_rate_limits


class BlocklistUpdateRequest(BaseModel):
    words: List[str] = Field(default_factory=list, min_items=1)


class UnblockIPRequest(BaseModel):
    ip: str = Field(..., min_length=1)


router = APIRouter(prefix="/moderation", tags=["moderation"])


def _ensure_owner(user: User) -> None:
    if user.username != OWNER_USERNAME:
        raise HTTPException(status_code=403, detail="Only owner can perform this action")


@router.get("/blocklist")
def list_blocklist(current_user: User = Depends(get_current_user)):
    _ensure_owner(current_user)
    return {"words": get_blocklist()}


@router.post("/blocklist")
def append_blocklist(
    request: BlocklistUpdateRequest,
    current_user: User = Depends(get_current_user)
):
    _ensure_owner(current_user)
    added, updated = add_to_blocklist(request.words)
    log_security(
        "blocklist_add",
        actor=current_user.username,
        actor_id=current_user.id,
        added=added,
    )
    return {"added": added, "words": updated}


@router.delete("/blocklist")
def delete_from_blocklist(
    request: BlocklistUpdateRequest,
    current_user: User = Depends(get_current_user)
):
    _ensure_owner(current_user)
    removed, updated = remove_from_blocklist(request.words)
    log_security(
        "blocklist_remove",
        actor=current_user.username,
        actor_id=current_user.id,
        removed=removed,
    )
    return {"removed": removed, "words": updated}


@router.post("/unblock-ip")
def unblock_ip(
    request: UnblockIPRequest,
    current_user: User = Depends(get_current_user)
):
    """Unblock an IP address from rate limiting."""
    _ensure_owner(current_user)
    ip = request.ip.strip()
    
    if not ip:
        raise HTTPException(status_code=400, detail="IP address is required")
    
    cleared = reset_rate_limit_for_ip(ip)
    
    log_security(
        "rate_limit_unblock",
        actor=current_user.username,
        actor_id=current_user.id,
        ip=ip,
        success=cleared,
    )
    
    if cleared:
        return {"status": "success", "message": f"Rate limit cleared for IP: {ip}"}
    else:
        return {"status": "success", "message": f"No rate limit entries found for IP: {ip}"}


@router.post("/clear-all-rate-limits")
def clear_all_rate_limits_endpoint(
    current_user: User = Depends(get_current_user)
):
    """Clear all rate limit entries. Use with caution."""
    _ensure_owner(current_user)
    
    cleared = clear_all_rate_limits()
    
    log_security(
        "rate_limit_clear_all",
        actor=current_user.username,
        actor_id=current_user.id,
        entries_cleared=cleared,
    )
    
    return {"status": "success", "message": f"Cleared {cleared} rate limit entries"}



