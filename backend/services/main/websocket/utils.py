from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from types import SimpleNamespace
from ..dependencies import get_current_user
from ..models import User


def extract_token_from_data(data: dict) -> str | None:
    """Extract authentication token from WebSocket message data.
    
    Args:
        data: WebSocket message data dictionary
        
    Returns:
        Token string or None if not present
    """
    credentials = data.get("credentials")
    if credentials and isinstance(credentials, dict):
        return credentials.get("credentials")
    return None


def get_current_user_from_token(token: str, db: Session) -> User | None:
    """Get user from authentication token.
    
    Args:
        token: JWT token string
        db: Database session
        
    Returns:
        User object or None if token is invalid
    """
    try:
        # Ensure session is in a usable state before querying
        try:
            db.rollback()
        except Exception:
            pass
        
        dummy_request = SimpleNamespace()
        dummy_request.state = SimpleNamespace()
        
        try:
            from fastapi.security import HTTPBearer
            security = HTTPBearer()
            # We need to create credentials manually
            credentials = HTTPAuthorizationCredentials(
                scheme="Bearer",
                credentials=token
            )
            return get_current_user(dummy_request, credentials, db)
        except HTTPException:
            return None
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


def authenticate_user(data: dict, db: Session, authRequired: bool) -> User | None:
    """Authenticate user from WebSocket message data.
    
    Args:
        data: WebSocket message data dictionary
        db: Database session
        authRequired: If True, raises 401 on missing/invalid token
        
    Returns:
        User object (guaranteed not None if authRequired=True) or None
        
    Raises:
        HTTPException: 401 if authRequired=True and token is missing/invalid
    """
    token = extract_token_from_data(data)
    
    if authRequired:
        if not token:
            raise HTTPException(status_code=401, detail="Missing credentials")
        
        user = get_current_user_from_token(token, db)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        return user
    else:
        if token:
            return get_current_user_from_token(token, db)
        return None

