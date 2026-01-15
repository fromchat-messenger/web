"""
Helper functions for inter-service communication used by the main service.

Behavior:
- In development (single-process) the helpers call the in-process service modules directly.
- In Docker/production the helpers perform HTTP calls to the configured service URLs.
"""
from typing import Optional, Dict, Any
import os
import logging
import json

# Import request models for in-process calls

logger = logging.getLogger("uvicorn.error")


def _get_messaging_module():
    try:
        from backend.services.messaging import main as messaging_module
        return messaging_module
    except Exception:
        try:
            from services.messaging import main as messaging_module  # type: ignore
            return messaging_module
        except Exception:
            return None


def _get_file_storage_module():
    try:
        from backend.services.file_storage import main as storage_module
        return storage_module
    except Exception:
        try:
            from services.file_storage import main as storage_module  # type: ignore
            return storage_module
        except Exception:
            return None


async def get_messaging_transport_public_key(timeout: float = 5.0) -> Dict[str, Any]:
    """
    Return messaging service ephemeral transport public key.
    """
    mod = _get_messaging_module()
    if mod:
        # in-process async call
        try:
            return await mod.get_transport_public_key()  # type: ignore
        except Exception as e:
            logger.error("In-process messaging.get_transport_public_key failed: %s", e)
            raise

    # Out-of-process HTTP
    messaging_url = os.getenv("MESSAGING_SERVICE_URL", "http://messaging:8301")
    url = f"{messaging_url.rstrip('/')}/key/transport/public"
    try:
        try:
            import httpx
            r = httpx.get(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            from urllib import request
            with request.urlopen(url, timeout=timeout) as r:
                return json.loads(r.read())
    except Exception as e:
        logger.error("Failed to fetch messaging transport public key: %s", e)
        raise


async def get_compliance_public_key(timeout: float = 5.0) -> Dict[str, Any]:
    """
    Return compliance system public key (for MEK wrapping).
    """
    mod = _get_messaging_module()
    if mod:
        # in-process async call
        try:
            key = mod.get_compliance_public_key()
            return {"public_key_b64": key}
        except Exception as e:
            logger.error("In-process messaging.get_compliance_public_key failed: %s", e)
            raise

    # Out-of-process: Compliance key should be configured via environment variable
    # The compliance public key is not exposed via HTTP for security reasons
    compliance_key = os.getenv("COMPLIANCE_PUBLIC_KEY", "").strip()
    if compliance_key:
        return {"public_key_b64": compliance_key}

    logger.error("COMPLIANCE_PUBLIC_KEY environment variable not set and messaging service not available in-process")
    raise RuntimeError("Compliance public key not available - set COMPLIANCE_PUBLIC_KEY environment variable")


async def invalidate_messaging_key(timeout: float = 5.0) -> Dict[str, Any]:
    """
    Request messaging service to invalidate its current ephemeral transport key (rotate).
    """
    mod = _get_messaging_module()
    if mod:
        try:
            return await mod.invalidate_transport_key()  # type: ignore
        except Exception as e:
            logger.error("In-process messaging.invalidate_transport_key failed: %s", e)
            raise

    messaging_url = os.getenv("MESSAGING_SERVICE_URL", "http://messaging:8301")
    url = f"{messaging_url.rstrip('/')}/key/transport/invalidate"
    try:
        try:
            import httpx
            r = httpx.post(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            from urllib import request
            req = request.Request(url, method="POST")
            with request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
    except Exception as e:
        logger.error("Failed to invalidate messaging key: %s", e)
        raise


async def upload_file_to_storage(file_obj: Any, timeout: float = 30.0) -> Dict[str, Any]:
    """
    Upload a file to file storage service. Returns JSON response.
    In-process: calls the in-process service.
    Out-of-process: performs HTTP call to configured service URL.
    """
    mod = _get_file_storage_module()
    if mod:
        try:
            # Call the upload endpoint directly on the in-process module
            return await mod.upload_file(None, file_obj)  # type: ignore
        except Exception as e:
            logger.error("In-process file_storage.upload_file failed: %s", e)
            raise

    # Out-of-process HTTP
    # Prefer explicit FILE_STORAGE_URL, fall back to FILE_STORAGE_SERVICE_URL, default to localhost for dev
    storage_url = os.getenv("FILE_STORAGE_URL") or os.getenv("FILE_STORAGE_SERVICE_URL") or "http://127.0.0.1:8302"
    url = f"{storage_url.rstrip('/')}/upload"
    try:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(url, files={"file": file_obj})
                r.raise_for_status()
                return r.json()
        except Exception:
            from urllib import request
            # Synchronous fallback using urllib
            req = request.Request(url, method="POST")
            if hasattr(file_obj, "read"):
                data = file_obj.read()
            else:
                data = file_obj
            req.data = data
            req.add_header("Content-Type", "application/octet-stream")
            with request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
    except Exception as e:
        logger.error("Failed to upload file to storage: %s", e)
        raise


async def store_encrypted_file(
    encrypted_file_data_b64: str,
    filename: str,
    content_type: str = "application/octet-stream",
    sender_id: int = None,
    recipient_id: int = None,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """
    Store an encrypted file (base64 encoded) in the file storage service.

    Returns:
        {
            "file_id": stored filename,
            "filename": original filename,
            "size": file size in bytes,
            "path": access path
        }
    """
    mod = _get_file_storage_module()
    if mod:
        try:
            # In-process: call the upload-base64 endpoint directly
            return await mod.upload_base64_file(
                None,  # request - not needed for in-process
                filename=filename,
                data_b64=encrypted_file_data_b64,
                content_type=content_type,
            )  # type: ignore
        except Exception as e:
            logger.error("In-process file_storage.store_encrypted_file failed: %s", e)
            raise

    # Out-of-process HTTP
    # Prefer explicit FILE_STORAGE_URL, fall back to FILE_STORAGE_SERVICE_URL, default to localhost for dev
    file_storage_url = os.getenv("FILE_STORAGE_URL") or os.getenv("FILE_STORAGE_SERVICE_URL") or "http://127.0.0.1:8302"
    url = f"{file_storage_url.rstrip('/')}/upload-base64"
    try:
        try:
            import httpx
            allowed_user_ids = []
            if sender_id is not None:
                allowed_user_ids.append(sender_id)
            if recipient_id is not None:
                allowed_user_ids.append(recipient_id)

            payload = {
                "filename": filename,
                "data_b64": encrypted_file_data_b64,
                "content_type": content_type,
                "allowed_user_ids": allowed_user_ids,
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                return r.json()
        except Exception:
            from urllib import request
            allowed_user_ids = []
            if sender_id is not None:
                allowed_user_ids.append(sender_id)
            if recipient_id is not None:
                allowed_user_ids.append(recipient_id)

            payload = {
                "filename": filename,
                "data_b64": encrypted_file_data_b64,
                "content_type": content_type,
                "allowed_user_ids": allowed_user_ids,
            }
            req = request.Request(url, method="POST")
            req.data = json.dumps(payload).encode("utf-8")
            req.add_header("Content-Type", "application/json")
            with request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
    except Exception as e:
        logger.error("Failed to store encrypted file: %s", e)
        # Fallback: attempt to store the file locally under data/file_storage/files
        try:
            import base64
            from pathlib import Path
            import uuid

            # Store encrypted files in the same directory the messaging service serves from
            FILES_DIR = Path("data/uploads/files/encrypted")
            FILES_DIR.mkdir(parents=True, exist_ok=True)

            decoded = base64.b64decode(encrypted_file_data_b64)
            stored_name = f"{uuid.uuid4().hex}_{filename}"
            dest = FILES_DIR / stored_name
            with open(dest, "wb") as f:
                f.write(decoded)
            try:
                dest.chmod(0o644)
            except Exception:
                logger.debug("Could not chmod fallback file %s", dest)

            logger.info("FALLBACK: Stored encrypted file locally: %s", dest)
            return {
                "file_id": stored_name,
                "filename": filename,
                "size": len(decoded),
                "path": f"/uploads/files/encrypted/{stored_name}",
            }
        except Exception as e2:
            logger.exception("Fallback local storage failed: %s", e2)
            raise


async def process_message_in_messaging_service(
    client_public_key_b64: str,
    transport_nonce_b64: str,
    transport_ciphertext_b64: str,
    compliance_public_key_b64: str,
    sender_public_key_b64: str,
    recipient_public_key_b64: str,
    timeout: float = 5.0,
) -> Dict[str, Any]:
    """
    Process an encrypted message through the messaging service envelope encryption pipeline.
    
    In-process: calls the in-process service.
    Out-of-process: performs HTTP call to configured service URL.
    
    Args:
        client_public_key_b64: Client's ephemeral public key
        transport_nonce_b64: Nonce for transport encryption
        transport_ciphertext_b64: Encrypted message
        compliance_public_key_b64: Compliance system public key
        sender_public_key_b64: Sender's public key
        recipient_public_key_b64: Recipient's public key
        timeout: Request timeout in seconds
    
    Returns:
        Dict with encrypted message and wrapped MEKs:
        {
            "nonce": base64-encoded nonce,
            "ciphertext": base64-encoded ciphertext,
            "compliance_wrapped_mek": wrapped MEK,
            "sender_wrapped_mek": wrapped MEK,
            "recipient_wrapped_mek": wrapped MEK,
        }
    """
    mod = _get_messaging_module()
    if mod:
        try:
            # In-process: call the process endpoint directly
            return await mod.process_message(
                client_public_key_b64=client_public_key_b64,
                transport_nonce_b64=transport_nonce_b64,
                transport_ciphertext_b64=transport_ciphertext_b64,
                compliance_public_key_b64=compliance_public_key_b64,
                sender_public_key_b64=sender_public_key_b64,
                recipient_public_key_b64=recipient_public_key_b64,
            )  # type: ignore
        except Exception as e:
            logger.error("In-process messaging.process_message failed: %s", e)
            raise

    # Out-of-process HTTP
    messaging_url = os.getenv("MESSAGING_SERVICE_URL", "http://messaging:8301")
    url = f"{messaging_url.rstrip('/')}/process"
    try:
        try:
            import httpx
            payload = {
                "client_public_key_b64": client_public_key_b64,
                "transport_nonce_b64": transport_nonce_b64,
                "transport_ciphertext_b64": transport_ciphertext_b64,
                "compliance_public_key_b64": compliance_public_key_b64,
                "sender_public_key_b64": sender_public_key_b64,
                "recipient_public_key_b64": recipient_public_key_b64,
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                return r.json()
        except Exception:
            from urllib import request
            payload = {
                "client_public_key_b64": client_public_key_b64,
                "transport_nonce_b64": transport_nonce_b64,
                "transport_ciphertext_b64": transport_ciphertext_b64,
                "compliance_public_key_b64": compliance_public_key_b64,
                "sender_public_key_b64": sender_public_key_b64,
                "recipient_public_key_b64": recipient_public_key_b64,
            }
            req = request.Request(url, method="POST")
            req.data = json.dumps(payload).encode("utf-8")
            req.add_header("Content-Type", "application/json")
            with request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
    except Exception as e:
        logger.error("Failed to process message in messaging service: %s", e)
        raise


async def process_message_with_files_in_messaging_service(
    client_public_key_b64: str,
    transport_nonce_b64: str,
    transport_ciphertext_b64: str,
    compliance_public_key_b64: str,
    sender_public_key_b64: str,
    recipient_public_key_b64: str,
    transport_files: list[dict[str, str]],
    timeout: float = 60.0,
) -> Dict[str, Any]:
    """
    Process an encrypted message and transport-encrypted files using a single MEK.

    Returns:
        {
            "message": {"nonce": str, "ciphertext": str},
            "files": [{"nonce": str, "ciphertext": str}, ...],
            "compliance_wrapped_mek": str,
            "sender_wrapped_mek": str,
            "recipient_wrapped_mek": str,
        }
    """
    mod = _get_messaging_module()
    if mod:
        try:
            return await mod.process_message_with_files(  # type: ignore
                client_public_key_b64=client_public_key_b64,
                transport_nonce_b64=transport_nonce_b64,
                transport_ciphertext_b64=transport_ciphertext_b64,
                compliance_public_key_b64=compliance_public_key_b64,
                sender_public_key_b64=sender_public_key_b64,
                recipient_public_key_b64=recipient_public_key_b64,
                files=[f["encrypted_file_data_b64"] for f in transport_files],
            )
        except Exception as e:
            logger.error("In-process messaging.process_message_with_files failed: %s", e)
            raise

    messaging_url = os.getenv("MESSAGING_SERVICE_URL", "http://messaging:8301")
    url = f"{messaging_url.rstrip('/')}/process-with-files"
    payload = {
        "client_public_key_b64": client_public_key_b64,
        "transport_nonce_b64": transport_nonce_b64,
        "transport_ciphertext_b64": transport_ciphertext_b64,
        "compliance_public_key_b64": compliance_public_key_b64,
        "sender_public_key_b64": sender_public_key_b64,
        "recipient_public_key_b64": recipient_public_key_b64,
        "files": transport_files,
    }
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Failed to process message+files in messaging service: %s", e)
        raise


