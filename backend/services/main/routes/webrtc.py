import logging
import os
import hmac
import hashlib
import time
from fastapi import APIRouter, Depends
from ..dependencies import get_current_user
import traceback

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


def generate_turn_credentials(username: str, secret: str, expiration_minutes: int = 60):
    """Generate time-limited TURN credentials using TURN REST API format.
    
    This creates temporary credentials that expire after the specified time.
    The username format is: timestamp:username
    The password is an HMAC hash of the username and secret.
    """
    # Current timestamp (seconds since epoch)
    timestamp = int(time.time()) + (expiration_minutes * 60)
    
    # Create temporary username: timestamp:original_username
    temp_username = f"{timestamp}:{username}"
    
    # Generate password using HMAC-SHA1
    temp_password = hmac.new(
        secret.encode('utf-8'),
        temp_username.encode('utf-8'),
        hashlib.sha1
    ).hexdigest()
    
    return temp_username, temp_password


@router.get("/ice")
async def get_ice_servers(current_user = Depends(get_current_user)):
    """Return ICE server configuration (STUN/TURN) for WebRTC clients.
    
    Generates time-limited TURN credentials that expire in 1 hour.
    """
    try:
        # Prefer using your own coturn for both STUN and TURN
        turn_domain = "fromchat.ru"
        stun_urls = [
            f"stun:{turn_domain}:3478",
            f"stuns:{turn_domain}:5349",
        ]
        
        turn_urls = [
            f"turn:{turn_domain}:3478",
            f"turns:{turn_domain}:5349",
        ]

        # Get TURN configuration from environment
        turn_username = os.getenv("TURN_USERNAME")
        turn_secret = os.getenv("TURN_SECRET")

        # Check if required environment variables are set
        if not turn_username:
            logger.error("ERROR: TURN_USERNAME environment variable is not set")
            raise ValueError("TURN_USERNAME environment variable is not set")
        
        if not turn_secret:
            logger.error("ERROR: TURN_SECRET environment variable is not set")
            raise ValueError("TURN_SECRET environment variable is not set")

        ice_servers: list[dict] = [{"urls": url} for url in stun_urls]

        temp_username, temp_password = generate_turn_credentials(
            turn_username, 
            turn_secret, 
            expiration_minutes=60  # Expires in 1 hour
        )
        
        ice_servers.append({
            "urls": turn_urls,
            "username": temp_username,
            "credential": temp_password,
        })

        return {"iceServers": ice_servers}
        
    except Exception as e:
        logger.error(f"ERROR in /api/webrtc/ice: {str(e)}")
        logger.error(f"ERROR type: {type(e).__name__}")
        traceback.print_exc()
        raise