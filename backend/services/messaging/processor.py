"""
Message processing pipeline for envelope encryption.

This module handles the core envelope encryption workflow:
1. Decrypt client-encrypted message (transport encryption)
2. Generate random MEK
3. Encrypt plaintext with MEK
4. Wrap MEK for compliance, sender, and recipient
5. Store encrypted message + wrapped keys
"""

import logging
import json
import time
import base64
from typing import Dict, Any, Optional
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from .encryption import (
    decrypt_transport_message,
    generate_mek,
    encrypt_message,
    wrap_mek,
    derive_shared_secret,
    derive_key_from_shared_secret,
)

logger = logging.getLogger("uvicorn.error")


def process_encrypted_message(
    client_public_key_b64: str,
    transport_nonce_b64: str,
    transport_ciphertext_b64: str,
    compliance_public_key_b64: str,
    sender_public_key_b64: str,
    recipient_public_key_b64: str,
    ephemeral_private_key: X25519PrivateKey,
) -> Dict[str, Any]:
    """
    Process an encrypted message through the envelope encryption pipeline.
    
    Step 1: Decrypt client message using transport encryption (ephemeral keys)
    Step 2: Generate random MEK
    Step 3: Encrypt plaintext with MEK
    Step 4: Wrap MEK for compliance, sender, recipient (using their provided public keys)
    Step 5: Return encrypted message + 3 wrapped MEKs
    
    Args:
        client_public_key_b64: Client's ephemeral public key for transport decryption
        transport_nonce_b64: Nonce used for transport encryption
        transport_ciphertext_b64: Client's encrypted plaintext
        compliance_public_key_b64: Compliance system's public key for MEK wrapping
        sender_public_key_b64: Sender's public key for MEK wrapping
        recipient_public_key_b64: Recipient's public key for MEK wrapping
        ephemeral_private_key: Server's ephemeral X25519 private key
    
    Returns:
        Dict with encrypted message and wrapped MEKs:
        {
            "nonce": base64-encoded nonce for content encryption,
            "ciphertext": base64-encoded encrypted content,
            "compliance_wrapped_mek": base64-encoded wrapped MEK,
            "sender_wrapped_mek": base64-encoded wrapped MEK,
            "recipient_wrapped_mek": base64-encoded wrapped MEK,
        }
    """
    try:
        start_time = time.time()
        
        # Step 1: Decrypt transport message
        logger.info("CRYPTO: Starting envelope encryption processing")
        plaintext = decrypt_transport_message(
            client_public_key_b64,
            transport_nonce_b64,
            transport_ciphertext_b64,
            ephemeral_private_key,
        )
        logger.info(
            "CRYPTO: Transport decryption complete, plaintext size: %d bytes",
            len(plaintext)
        )

        # Step 2: Generate random MEK
        mek = generate_mek()
        logger.info("CRYPTO: Generated random MEK (32 bytes)")

        # Step 3: Encrypt plaintext with MEK
        content_nonce, ciphertext = encrypt_message(plaintext, mek)
        logger.info(
            "CRYPTO: Content encryption with MEK complete, ciphertext size: %d bytes",
            len(ciphertext)
        )

        # Step 4a: Derive wrap keys deterministically from recipient public keys
        # This avoids needing to store the ephemeral transport key
        logger.info("CRYPTO: Deriving key wrap keys deterministically")

        # Use HKDF with recipient public key bytes as input to derive wrap keys
        # This is deterministic and doesn't require storing ephemeral keys
        import base64
        compliance_key_bytes = base64.b64decode(compliance_public_key_b64)
        sender_key_bytes = base64.b64decode(sender_public_key_b64)
        recipient_key_bytes = base64.b64decode(recipient_public_key_b64)

        logger.info(f"🔑 Deriving wrap keys for sender={sender_public_key_b64[:20]}... recipient={recipient_public_key_b64[:20]}...")

        compliance_wrap_key = derive_key_from_shared_secret(compliance_key_bytes, "compliance_wrap_key")
        sender_wrap_key = derive_key_from_shared_secret(sender_key_bytes, "sender_wrap_key")
        recipient_wrap_key = derive_key_from_shared_secret(recipient_key_bytes, "recipient_wrap_key")

        logger.info("✅ Wrap keys derived successfully")

        # Step 4b: Wrap MEK for each recipient
        compliance_wrapped_mek = wrap_mek(mek, compliance_wrap_key)
        sender_wrapped_mek = wrap_mek(mek, sender_wrap_key)
        recipient_wrapped_mek = wrap_mek(mek, recipient_wrap_key)

        logger.info(f"🔐 MEK wrapping complete:")
        logger.info(f"   Compliance MEK: {compliance_wrapped_mek[:30]}... ({len(compliance_wrapped_mek)} chars)")
        logger.info(f"   Sender MEK: {sender_wrapped_mek[:30]}... ({len(sender_wrapped_mek)} chars)")
        logger.info(f"   Recipient MEK: {recipient_wrapped_mek[:30]}... ({len(recipient_wrapped_mek)} chars)")

        duration = time.time() - start_time
        logger.info(
            "CRYPTO: Successfully processed message with 3 MEK wraps (compliance/sender/recipient) in %.2fms",
            duration * 1000
        )

        # Get the transport public key for storage with the message
        transport_public_key_b64 = base64.b64encode(ephemeral_private_key.public_key().public_bytes_raw()).decode("ascii")

        return {
            "nonce": content_nonce,
            "ciphertext": ciphertext,
            "compliance_wrapped_mek": compliance_wrapped_mek,
            "sender_wrapped_mek": sender_wrapped_mek,
            "recipient_wrapped_mek": recipient_wrapped_mek,
        }

    except Exception as e:
        duration = time.time() - start_time
        logger.exception(
            "CRYPTO: Failed to process encrypted message after %.2fms: %s",
            duration * 1000, str(e)
        )
        raise


def process_encrypted_message_and_files(
    plaintext_message: bytes,
    plaintext_files: list[bytes],
    compliance_public_key_b64: str,
    sender_public_key_b64: str,
    recipient_public_key_b64: str,
) -> Dict[str, Any]:
    """
    Process a message and its attached files using a single MEK.

    - Generates one random MEK
    - Encrypts message and each file with AES-GCM using that MEK (unique nonce per item)
    - Wraps the MEK for compliance, sender, and recipient

    Returns:
        {
            "message": {"nonce": str, "ciphertext": str},
            "files": [{"nonce": str, "ciphertext": str}, ...],
            "compliance_wrapped_mek": str,
            "sender_wrapped_mek": str,
            "recipient_wrapped_mek": str,
        }
    """
    start_time = time.time()

    # One MEK for everything in this envelope
    mek = generate_mek()

    # Encrypt message
    msg_nonce, msg_ciphertext = encrypt_message(plaintext_message, mek)

    # Encrypt files (same MEK, per-file nonce)
    files_out: list[Dict[str, str]] = []
    for f_bytes in plaintext_files:
        f_nonce, f_ciphertext = encrypt_message(f_bytes, mek)
        files_out.append({"nonce": f_nonce, "ciphertext": f_ciphertext})

    # Derive wrap keys deterministically (same as existing flow)
    compliance_key_bytes = base64.b64decode(compliance_public_key_b64)
    sender_key_bytes = base64.b64decode(sender_public_key_b64)
    recipient_key_bytes = base64.b64decode(recipient_public_key_b64)

    compliance_wrap_key = derive_key_from_shared_secret(compliance_key_bytes, "compliance_wrap_key")
    sender_wrap_key = derive_key_from_shared_secret(sender_key_bytes, "sender_wrap_key")
    recipient_wrap_key = derive_key_from_shared_secret(recipient_key_bytes, "recipient_wrap_key")

    compliance_wrapped_mek = wrap_mek(mek, compliance_wrap_key)
    sender_wrapped_mek = wrap_mek(mek, sender_wrap_key)
    recipient_wrapped_mek = wrap_mek(mek, recipient_wrap_key)

    duration = time.time() - start_time
    logger.info(
        "CRYPTO: Processed message+%d files with single MEK in %.2fms",
        len(files_out),
        duration * 1000,
    )

    return {
        "message": {"nonce": msg_nonce, "ciphertext": msg_ciphertext},
        "files": files_out,
        "compliance_wrapped_mek": compliance_wrapped_mek,
        "sender_wrapped_mek": sender_wrapped_mek,
        "recipient_wrapped_mek": recipient_wrapped_mek,
    }
