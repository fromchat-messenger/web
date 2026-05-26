"""
Messaging Service - Secure cryptographic processing for private messages with compliance access.

This service handles all encryption/decryption operations for private messages and files,
providing compliance access while ensuring zero-knowledge storage of plaintext content.

API Endpoints:
- GET /health: Health check
- GET /key/transport/public: Get current ephemeral transport public key
- POST /process: Process encrypted message through envelope encryption pipeline
"""

import logging
import sys
import time
import base64
import os
import tempfile
from pathlib import Path
from typing import Dict, Any, Union
from fastapi import FastAPI, HTTPException, status
from nacl.exceptions import CryptoError
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel

logger = logging.getLogger("uvicorn.error")

_B64_DECODE_KW = {"validate": True} if sys.version_info >= (3, 11) else {}

# Import encryption modules
from .encryption import (
    generate_nonce,
    TRANSPORT_NONCE_SIZE,
    decrypt_transport_blob,
    decrypt_transport_message,
    is_fcae_transport_blob,
    decrypt_fcae_transport_blob_to_file,
)
from .processor import process_encrypted_message, process_encrypted_message_and_files

try:
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives import serialization
except ImportError:
    X25519PrivateKey = None


# ============================================================================
# Compliance Key Management
# ============================================================================

_COMPLIANCE_PUBLIC_KEY_B64: str = ""


def _initialize_compliance_key():
    """
    Initialize compliance public key from environment variable.
    
    The compliance public key is generated offline on an air-gapped machine.
    Only the public key is provided to the server via COMPLIANCE_PUBLIC_KEY env variable.
    The private key never exists on the server - all decryption is done offline.
    """
    global _COMPLIANCE_PUBLIC_KEY_B64

    try:
        from services.shared.message_retention import get_message_retention
    except ImportError:
        from backend.services.shared.message_retention import get_message_retention  # type: ignore

    if get_message_retention().never_store_compliance_mek():
        _COMPLIANCE_PUBLIC_KEY_B64 = ""
        logger.info(
            "Compliance MEK not stored (MESSAGE_RETENTION_DAYS=-1); COMPLIANCE_PUBLIC_KEY optional"
        )
        return

    env_key = os.getenv("COMPLIANCE_PUBLIC_KEY", "").strip()
    if not env_key:
        raise RuntimeError(
            "COMPLIANCE_PUBLIC_KEY environment variable must be set. "
            "Generate offline on an air-gapped machine: "
            "X25519 private key → export public key (base64) → set as env var"
        )

    _COMPLIANCE_PUBLIC_KEY_B64 = env_key
    logger.info("Loaded compliance public key from COMPLIANCE_PUBLIC_KEY environment variable")


def get_compliance_public_key() -> str:
    """Return the compliance system public key."""
    if not _COMPLIANCE_PUBLIC_KEY_B64:
        _initialize_compliance_key()
    return _COMPLIANCE_PUBLIC_KEY_B64


# ============================================================================
# Ephemeral Key Management
# ============================================================================

_KEY_STATE: Dict[str, Any] = {}


def _generate_keypair():
    """
    Generate a fresh X25519 keypair and store it in memory.
    
    This generates an ephemeral keypair for the session. The private key is kept
    in-memory and is never persisted. When a new keypair is generated, the old
    one is discarded and its associated data is no longer accessible.
    """
    if X25519PrivateKey is None:
        raise RuntimeError("cryptography library required for X25519 key generation")
    
    priv = X25519PrivateKey.generate()
    pub = priv.public_key()
    pub_bytes = pub.public_bytes(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    key_id = str(int(time.time() * 1000))  # Millisecond precision for uniqueness
    
    _KEY_STATE.clear()
    _KEY_STATE.update({
        "key_id": key_id,
        "private_key": priv,
        "public_key_b64": base64.b64encode(pub_bytes).decode("ascii"),
        "created_at": time.time(),
    })
    logger.info("Generated new ephemeral keypair with key_id=%s", key_id)


def _get_ephemeral_private_key() -> X25519PrivateKey:
    """Retrieve the current ephemeral private key, regenerating if necessary."""
    if not _KEY_STATE:
        _generate_keypair()
    return _KEY_STATE.get("private_key")


# ============================================================================
# FastAPI App Setup
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown event handler."""
    # Startup: Initialize compliance key and ephemeral keys
    try:
        _initialize_compliance_key()
        _generate_keypair()
        logger.info("Messaging service: initialized at startup")
    except Exception as e:
        logger.error("Messaging service: failed to initialize: %s", e)
        raise
    
    yield
    
    # Shutdown
    logger.info("Messaging service: shutting down")


app = FastAPI(
    title="FromChat Messaging Service",
    description="Secure cryptographic processing service for private messages",
    version="1.0.0",
    lifespan=lifespan,
)

# Add security middleware
try:
    from services.shared.middleware import add_security_middleware
except ImportError:
    try:
        from backend.services.shared.middleware import add_security_middleware
    except ImportError:
        add_security_middleware = None

if add_security_middleware:
    add_security_middleware(app)

try:
    from services.shared.inter_service_rate_limit import attach_internal_service_rate_limit
except ImportError:
    from backend.services.shared.inter_service_rate_limit import attach_internal_service_rate_limit  # type: ignore

_internal_limiter = attach_internal_service_rate_limit(app, default_limit="5000/minute")

# CORS configuration for inter-service communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for inter-service communication
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Pydantic Models
# ============================================================================

class ProcessMessageRequest(BaseModel):
    """
    Request to process an encrypted message through the envelope encryption pipeline.

    The client must:
    1. Encrypt plaintext with the ephemeral transport public key using X25519 + ChaCha20
    2. Provide the encrypted message and associated metadata
    3. Provide public keys for compliance, sender, and recipient for MEK wrapping
    """
    client_public_key_b64: str
    transport_nonce_b64: str
    transport_ciphertext_b64: str
    compliance_public_key_b64: str
    sender_public_key_b64: str
    recipient_public_key_b64: str


class ProcessMessageWithFilesFile(BaseModel):
    """
    A single transport-encrypted file blob (base64 of nonce||ciphertext),
    encrypted with the same ephemeral client key as the message body.
    """
    encrypted_file_data_b64: str
    filename: str = "file"


class ProcessMessageWithFilesRequest(ProcessMessageRequest):
    """
    Process a transport-encrypted message and a list of transport-encrypted files
    using a single MEK for the whole envelope.

    Each file blob uses the same client_public_key_b64 / X25519 ephemeral pair as the message.
    """
    files: list[ProcessMessageWithFilesFile]

# ============================================================================
# Health Checks
# ============================================================================

@app.get("/health", response_model=None)
@_internal_limiter.exempt
async def health_check():
    """Health check endpoint for messaging service."""
    return {"status": "healthy", "service": "messaging"}


@app.get("/", response_model=None)
async def root():
    """Root endpoint for messaging service."""
    return {"message": "FromChat Messaging Service", "status": "operational"}


# ============================================================================
# Ephemeral Key Endpoints
# ============================================================================

@app.get("/key/transport/public", response_model=None)
async def get_transport_public_key():
    """
    Return the current ephemeral transport public key for client-side message encryption.
    
    Clients use this key to encrypt their messages with X25519 + ChaCha20-Poly1305
    before sending to the server.
    """
    if not _KEY_STATE:
        try:
            _generate_keypair()
        except Exception as e:
            logger.error("Failed to regenerate ephemeral key: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Key generation failed"
            )
    
    return {
        "key_id": _KEY_STATE.get("key_id"),
        "public_key_b64": _KEY_STATE.get("public_key_b64"),
        "created_at": _KEY_STATE.get("created_at"),
    }




# ============================================================================
# Message Processing Endpoints
# ============================================================================

async def process_message(
    client_public_key_b64: str,
    transport_nonce_b64: str,
    transport_ciphertext_b64: str,
    compliance_public_key_b64: str,
    sender_public_key_b64: str,
    recipient_public_key_b64: str,
):
    """
    Process an encrypted message through the envelope encryption pipeline.
    
    This is the core processing function used by both HTTP and in-process calls.
    
    Flow:
    1. Decrypt client message using transport encryption (ephemeral key)
    2. Generate random MEK (Message Encryption Key)
    3. Encrypt plaintext with MEK using ChaCha20-Poly1305
    4. Wrap MEK for compliance, sender, and recipient
    5. Return encrypted message + 3 wrapped MEKs
    
    Args:
        client_public_key_b64: Client's ephemeral public key
        transport_nonce_b64: Nonce for transport encryption
        transport_ciphertext_b64: Encrypted message
        compliance_public_key_b64: Compliance system public key
        sender_public_key_b64: Sender's public key
        recipient_public_key_b64: Recipient's public key
    
    Returns:
        Dict with:
        - nonce: Base64-encoded nonce for content encryption
        - ciphertext: Base64-encoded encrypted content
        - compliance_wrapped_mek: Wrapped MEK for compliance system
        - sender_wrapped_mek: Wrapped MEK for message sender
        - recipient_wrapped_mek: Wrapped MEK for message recipient
    """
    try:
        private_key = _get_ephemeral_private_key()
        
        result = process_encrypted_message(
            client_public_key_b64=client_public_key_b64,
            transport_nonce_b64=transport_nonce_b64,
            transport_ciphertext_b64=transport_ciphertext_b64,
            compliance_public_key_b64=compliance_public_key_b64,
            sender_public_key_b64=sender_public_key_b64,
            recipient_public_key_b64=recipient_public_key_b64,
            ephemeral_private_key=private_key,
        )
        
        logger.info("Successfully processed encrypted message")
        return result
        
    except Exception as e:
        logger.exception("Failed to process message: %s", e)
        raise


@app.post("/process", response_model=None)
async def process_message_http(request: ProcessMessageRequest):
    """
    HTTP endpoint for processing encrypted messages.

    Delegates to the core process_message function.
    """
    return await process_message(
        client_public_key_b64=request.client_public_key_b64,
        transport_nonce_b64=request.transport_nonce_b64,
        transport_ciphertext_b64=request.transport_ciphertext_b64,
        compliance_public_key_b64=request.compliance_public_key_b64,
        sender_public_key_b64=request.sender_public_key_b64,
        recipient_public_key_b64=request.recipient_public_key_b64,
    )


async def process_message_with_files(
    client_public_key_b64: str,
    transport_nonce_b64: str,
    transport_ciphertext_b64: str,
    compliance_public_key_b64: str,
    sender_public_key_b64: str,
    recipient_public_key_b64: str,
    transport_files: list[dict],
):
    """
    In-process helper: process message + transport-encrypted files with one MEK.

    File blobs must be encrypted with the same ephemeral client key as the message
    (same client_public_key_b64), not the sender's long-term identity key.
    transport_files: list of {"encrypted_file_data_b64": str, "filename": str}
    """
    private_key = _get_ephemeral_private_key()

    plaintext_message = decrypt_transport_message(
        client_public_key_b64,
        transport_nonce_b64,
        transport_ciphertext_b64,
        private_key,
    )

    plaintext_files: list[bytes] = []
    plaintext_file_paths: list[Path | None] = []
    filenames: list[str] = []
    temp_paths: list[Path] = []
    try:
        for idx, tf in enumerate(transport_files):
            enc_path = (tf.get("encrypted_file_path") or "").strip()
            if enc_path:
                blob_path = Path(enc_path)
                if not blob_path.is_file():
                    raise ValueError(f"Transport file path missing index={idx}")
                prefix = blob_path.read_bytes()[: len(b"FCAE") + 1]
                if is_fcae_transport_blob(prefix):
                    plain_tmp = Path(tempfile.mkstemp(prefix="fcae-plain-", suffix=".bin")[1])
                    temp_paths.append(plain_tmp)
                    decrypt_fcae_transport_blob_to_file(
                        client_public_key_b64=client_public_key_b64,
                        encrypted_path=blob_path,
                        ephemeral_private_key=private_key,
                        output_path=plain_tmp,
                    )
                    plaintext_files.append(b"")
                    plaintext_file_paths.append(plain_tmp)
                else:
                    transport_blob = blob_path.read_bytes()
                    plaintext_files.append(
                        decrypt_transport_blob(
                            client_public_key_b64=client_public_key_b64,
                            encrypted_blob=transport_blob,
                            ephemeral_private_key=private_key,
                        )
                    )
                    plaintext_file_paths.append(None)
            else:
                enc_b64 = tf.get("encrypted_file_data_b64", "")
                try:
                    transport_blob = base64.b64decode(enc_b64, **_B64_DECODE_KW)
                except Exception as e:
                    logger.error(
                        "Invalid base64 for transport file index=%s filename=%r: %s",
                        idx,
                        tf.get("filename"),
                        e,
                    )
                    raise
                try:
                    plaintext_files.append(
                        decrypt_transport_blob(
                            client_public_key_b64=client_public_key_b64,
                            encrypted_blob=transport_blob,
                            ephemeral_private_key=private_key,
                        )
                    )
                except Exception as e:
                    logger.error(
                        "Transport file decrypt failed index=%s filename=%r (check same ephemeral as message): %s",
                        idx,
                        tf.get("filename"),
                        e,
                    )
                    raise
                plaintext_file_paths.append(None)
            filenames.append(tf.get("filename", "file"))

        return process_encrypted_message_and_files(
            plaintext_message=plaintext_message,
            plaintext_files=plaintext_files,
            filenames=filenames,
            plaintext_file_paths=plaintext_file_paths,
            compliance_public_key_b64=compliance_public_key_b64,
            sender_public_key_b64=sender_public_key_b64,
            recipient_public_key_b64=recipient_public_key_b64,
        )
    finally:
        for p in temp_paths:
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass


@app.post("/process-with-files", response_model=None)
async def process_message_with_files_http(request: ProcessMessageWithFilesRequest):
    """
    Process an encrypted message and its files using a single MEK.

    - Message and file transport layers use the same client ephemeral X25519 keypair
      (client_public_key_b64); files are NaCl box ciphertexts to the server transport key
    - One MEK is generated and used to encrypt message + all files
    - MEK is wrapped for compliance, sender, and recipient (stored on DM envelope)
    """
    try:
        transport_files = [
            {"encrypted_file_data_b64": f.encrypted_file_data_b64, "filename": f.filename}
            for f in request.files
        ]
        return await process_message_with_files(
            client_public_key_b64=request.client_public_key_b64,
            transport_nonce_b64=request.transport_nonce_b64,
            transport_ciphertext_b64=request.transport_ciphertext_b64,
            compliance_public_key_b64=request.compliance_public_key_b64,
            sender_public_key_b64=request.sender_public_key_b64,
            recipient_public_key_b64=request.recipient_public_key_b64,
            transport_files=transport_files,
        )
    except CryptoError as e:
        logger.warning("process-with-files: transport CryptoError: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Transport decryption failed: message and files must use the same client ephemeral "
                "key as when file ciphertext was produced."
            ),
        ) from e
    except Exception as e:
        logger.exception("Failed to process message with files: %s", e)
        raise

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8301"))
    uvicorn.run(app, host="0.0.0.0", port=port)
