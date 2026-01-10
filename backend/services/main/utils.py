from datetime import datetime, timedelta
from fastapi import Request
import jwt
from typing import Optional, Any
import bcrypt

from .constants import MAX_TOKEN_LIFETIME_HOURS, JWT_SECRET_KEY, JWT_ALGORITHM

# JWT Helper Functions
def create_token(user_id: int, username: str, session_id: str) -> str:
    # Set a long expiration as safety net (actual expiration based on inactivity)
    expire = datetime.now() + timedelta(hours=MAX_TOKEN_LIFETIME_HOURS)
    payload = {
        "user_id": user_id,
        "username": username,
        "session_id": session_id,
        "exp": int(expire.timestamp())  # JWT exp must be Unix timestamp (int)
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def get_client_ip(request: Request) -> Optional[str]:
    if not request:
        return None

    headers = request.headers
    
    # First, check x-real-ip header (set by some proxies, or configured in Caddy)
    real_ip = headers.get("x-real-ip") or headers.get("X-Real-IP")
    if real_ip:
        candidate = real_ip.strip()
        if candidate:
            return candidate
    
    # Fall back to x-forwarded-for header (Caddy sets this automatically)
    forwarded = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if forwarded:
        # X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
        # Take the first one (original client IP)
        candidate = forwarded.split(",")[0].strip()
        if candidate:
            return candidate

    # Fall back to direct client connection (when not behind a proxy)
    if request.client and request.client.host:
        return request.client.host

    # Last resort: check scope
    if isinstance(request.scope, dict):
        client_info = request.scope.get("client")
        if isinstance(client_info, (list, tuple)) and client_info:
            return client_info[0]

    return None