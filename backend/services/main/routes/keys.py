from fastapi import APIRouter, HTTPException
import os
import logging

router = APIRouter()
logger = logging.getLogger("uvicorn.error")


def _get_messaging_module():
    """Try to import in-process messaging module; return None if unavailable."""
    try:
        from backend.services.messaging import main as messaging_module
        return messaging_module
    except Exception:
        try:
            # Fallback to package import when running with CWD=backend
            from services.messaging import main as messaging_module  # type: ignore
            return messaging_module
        except Exception:
            return None


@router.get("/key/public")
async def get_public_key():
    """
    Return the current messaging service ephemeral public key.
    If messaging service is in-process, call its function directly; otherwise, perform HTTP request to configured service URL.
    """
    messaging_module = _get_messaging_module()
    if messaging_module:
        try:
            data = await messaging_module.get_public_key()  # type: ignore
            return data
        except Exception as e:
            logger.error(f"Failed to get public key from in-process messaging module: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve messaging public key")

    # Out-of-process: call messaging service over HTTP
    messaging_url = os.getenv("MESSAGING_SERVICE_URL", "http://messaging:8301")
    url = f"{messaging_url.rstrip('/')}/key/public"
    try:
        # Prefer httpx if available
        try:
            import httpx
            resp = httpx.get(url, timeout=5.0)
            resp.raise_for_status()
            return resp.json()
        except Exception:
            # Fallback to urllib
            from urllib import request, error
            import json
            with request.urlopen(url, timeout=5) as r:
                body = r.read()
                return json.loads(body)
    except Exception as e:
        logger.error(f"Failed to fetch messaging public key via HTTP: {e}")
        raise HTTPException(status_code=502, detail="Failed to contact messaging service")

