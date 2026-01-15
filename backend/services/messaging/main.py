"""
Messaging Service - Secure cryptographic processing for private messages with compliance access.

This service handles all encryption/decryption operations for private messages and files,
providing compliance access while ensuring zero-knowledge storage of plaintext content.

API Endpoints:
- GET /health: Health check
- GET /key/public: Get current ephemeral transport public key
- POST /key/invalidate: Rotate ephemeral keys
- POST /process: Process encrypted message through envelope encryption pipeline
"""

import logging
import time
import base64
import os
from typing import Dict, Any
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel

logger = logging.getLogger("uvicorn.error")

# Import encryption modules
from .encryption import generate_nonce, TRANSPORT_NONCE_SIZE, decrypt_transport_blob, decrypt_transport_message
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
    A single transport-encrypted file blob (base64 of nonce||ciphertext).
    """
    encrypted_file_data_b64: str


class ProcessMessageWithFilesRequest(ProcessMessageRequest):
    """
    Process a transport-encrypted message and a list of transport-encrypted files
    using a single MEK for the whole envelope.
    """
    files: list[ProcessMessageWithFilesFile]

# ============================================================================
# Health Checks
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint for messaging service."""
    return {"status": "healthy", "service": "messaging"}


@app.get("/")
async def root():
    """Root endpoint for messaging service."""
    return {"message": "FromChat Messaging Service", "status": "operational"}


# ============================================================================
# Ephemeral Key Endpoints
# ============================================================================

@app.get("/key/transport/public")
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


@app.post("/process")
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
    files: list[str],
):
    """
    In-process helper: process message + transport-encrypted files with one MEK.
    """
    private_key = _get_ephemeral_private_key()

    plaintext_message = decrypt_transport_message(
        client_public_key_b64,
        transport_nonce_b64,
        transport_ciphertext_b64,
        private_key,
    )

    plaintext_files: list[bytes] = []
    for encrypted_file_data_b64 in files:
        transport_blob = base64.b64decode(encrypted_file_data_b64)
        plaintext_files.append(
            decrypt_transport_blob(
                client_public_key_b64=sender_public_key_b64,
                encrypted_blob=transport_blob,
                ephemeral_private_key=private_key,
            )
        )

    return process_encrypted_message_and_files(
        plaintext_message=plaintext_message,
        plaintext_files=plaintext_files,
        compliance_public_key_b64=compliance_public_key_b64,
        sender_public_key_b64=sender_public_key_b64,
        recipient_public_key_b64=recipient_public_key_b64,
    )


@app.post("/process-with-files")
async def process_message_with_files_http(request: ProcessMessageWithFilesRequest):
    """
    Process an encrypted message and its files using a single MEK.

    - Message transport layer is decrypted using the message client ephemeral key
    - File transport layer is decrypted using the sender long-term public key
    - One MEK is generated and used to encrypt message + all files
    - MEK is wrapped for compliance, sender, and recipient (stored on DM envelope)
    """
    try:
        return await process_message_with_files(
            client_public_key_b64=request.client_public_key_b64,
            transport_nonce_b64=request.transport_nonce_b64,
            transport_ciphertext_b64=request.transport_ciphertext_b64,
            compliance_public_key_b64=request.compliance_public_key_b64,
            sender_public_key_b64=request.sender_public_key_b64,
            recipient_public_key_b64=request.recipient_public_key_b64,
            files=[f.encrypted_file_data_b64 for f in request.files],
        )
    except Exception as e:
        logger.exception("Failed to process message with files: %s", e)
        raise

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8301"))
    uvicorn.run(app, host="0.0.0.0", port=port)
