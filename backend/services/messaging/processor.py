"""
Message processing pipeline for envelope encryption.

This module handles the core envelope encryption workflow:
1. Decrypt client-encrypted message (transport encryption)
2. Generate random MEK
3. Encrypt plaintext with MEK
4. Wrap MEK for compliance, sender, and recipient
5. Store encrypted message + wrapped keys
"""

import io
import logging
import json
import time
import base64
from pathlib import Path
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


def _store_compliance_wrapped_mek() -> bool:
    try:
        from services.shared.message_retention import get_message_retention
    except ImportError:
        from backend.services.shared.message_retention import get_message_retention  # type: ignore
    return not get_message_retention().never_store_compliance_mek()


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
        sender_key_bytes = base64.b64decode(sender_public_key_b64)
        recipient_key_bytes = base64.b64decode(recipient_public_key_b64)

        logger.info(
            "🔑 Deriving wrap keys for sender=%s... recipient=%s...",
            sender_public_key_b64[:20],
            recipient_public_key_b64[:20],
        )

        sender_wrap_key = derive_key_from_shared_secret(sender_key_bytes, "sender_wrap_key")
        recipient_wrap_key = derive_key_from_shared_secret(recipient_key_bytes, "recipient_wrap_key")

        logger.info("✅ Sender/recipient wrap keys derived successfully")

        if _store_compliance_wrapped_mek():
            if not (compliance_public_key_b64 or "").strip():
                raise ValueError(
                    "compliance public key required when MESSAGE_RETENTION_DAYS is not -1"
                )
            compliance_key_bytes = base64.b64decode(compliance_public_key_b64)
            compliance_wrap_key = derive_key_from_shared_secret(
                compliance_key_bytes, "compliance_wrap_key"
            )
            compliance_wrapped_mek = wrap_mek(mek, compliance_wrap_key)
            logger.info(
                "🔐 Compliance MEK: %s... (%s chars)",
                compliance_wrapped_mek[:30],
                len(compliance_wrapped_mek),
            )
        else:
            compliance_wrapped_mek = None
            logger.info("CRYPTO: Compliance MEK not stored (MESSAGE_RETENTION_DAYS=-1)")

        sender_wrapped_mek = wrap_mek(mek, sender_wrap_key)
        recipient_wrapped_mek = wrap_mek(mek, recipient_wrap_key)

        logger.info(f"🔐 MEK wrapping complete:")
        logger.info(f"   Sender MEK: {sender_wrapped_mek[:30]}... ({len(sender_wrapped_mek)} chars)")
        logger.info(f"   Recipient MEK: {recipient_wrapped_mek[:30]}... ({len(recipient_wrapped_mek)} chars)")

        duration = time.time() - start_time
        logger.info(
            "CRYPTO: Successfully processed message with MEK wraps in %.2fms",
            duration * 1000,
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


_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
_THUMB_SIZE = 80


def _generate_thumbnail(image_bytes: bytes) -> tuple[str | None, list[int]]:
    """Generate tiny JPEG thumbnail (Telegram-style). Returns (base64_jpeg, [w,h]) or (None, [1,1]) on error."""
    try:
        from math import gcd
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        img = img.convert("RGB")
        if hasattr(img, "info") and img.info:
            img.info.pop("icc_profile", None)
        w, h = img.size
        g = gcd(w, h) if h else 1
        aspect_wh = [w // g, h // g] if g else [1, 1]
        if w > _THUMB_SIZE or h > _THUMB_SIZE:
            scale = min(_THUMB_SIZE / w, _THUMB_SIZE / h)
            new_w = max(1, int(w * scale))
            new_h = max(1, int(h * scale))
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85, optimize=True)
        jpeg_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        logger.info("THUMB: Image %dx%d -> thumb %dx%d, b64len=%d", w, h, img.width, img.height, len(jpeg_b64))
        return (jpeg_b64, aspect_wh)
    except Exception as e:
        logger.warning("THUMB: Generation failed: %s", e)
        return (None, [1, 1])


def process_encrypted_message_and_files(
    plaintext_message: bytes,
    plaintext_files: list[bytes],
    filenames: list[str],
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
            ...
        }
    """
    start_time = time.time()
    if len(filenames) != len(plaintext_files):
        filenames = [f"file_{i}" for i in range(len(plaintext_files))]

    # One MEK for everything in this envelope
    mek = generate_mek()

    # Build message plaintext: when we have files, use JSON with text + fileThumbnails + fileAspectRatios + fileSizes
    file_thumbnails: list[str] = []
    file_aspect_ratios: list[list[int]] = []
    file_sizes: list[int] = []
    for i, f_bytes in enumerate(plaintext_files):
        name = filenames[i] if i < len(filenames) else ""
        file_sizes.append(len(f_bytes))
        if Path(name).suffix.lower() in _IMAGE_EXTENSIONS:
            thumb_b64, wh = _generate_thumbnail(f_bytes)
            file_thumbnails.append(thumb_b64 or "")
            file_aspect_ratios.append(wh)
        else:
            file_thumbnails.append("")
            file_aspect_ratios.append([1, 1])

    if plaintext_files:
        msg_obj = {
            "text": plaintext_message.decode("utf-8", errors="replace"),
            "fileThumbnails": file_thumbnails,
            "fileAspectRatios": file_aspect_ratios,
            "fileSizes": file_sizes,
        }
        logger.info(
            "THUMB: Message with %d files, thumbnails=%s, aspectRatios=%s",
            len(file_thumbnails),
            [f"len={len(t)}" if t else "empty" for t in file_thumbnails],
            file_aspect_ratios,
        )
        plaintext_to_encrypt = json.dumps(msg_obj, ensure_ascii=False).encode("utf-8")
    else:
        plaintext_to_encrypt = plaintext_message

    # Encrypt message
    msg_nonce, msg_ciphertext = encrypt_message(plaintext_to_encrypt, mek)

    # Encrypt files (same MEK, per-file nonce)
    files_out: list[Dict[str, Any]] = []
    for i, f_bytes in enumerate(plaintext_files):
        f_nonce, f_ciphertext = encrypt_message(f_bytes, mek)
        entry: Dict[str, Any] = {"nonce": f_nonce, "ciphertext": f_ciphertext}
        files_out.append(entry)

    # Derive wrap keys deterministically (same as existing flow)
    sender_key_bytes = base64.b64decode(sender_public_key_b64)
    recipient_key_bytes = base64.b64decode(recipient_public_key_b64)

    sender_wrap_key = derive_key_from_shared_secret(sender_key_bytes, "sender_wrap_key")
    recipient_wrap_key = derive_key_from_shared_secret(recipient_key_bytes, "recipient_wrap_key")

    if _store_compliance_wrapped_mek():
        if not (compliance_public_key_b64 or "").strip():
            raise ValueError(
                "compliance public key required when MESSAGE_RETENTION_DAYS is not -1"
            )
        compliance_key_bytes = base64.b64decode(compliance_public_key_b64)
        compliance_wrap_key = derive_key_from_shared_secret(
            compliance_key_bytes, "compliance_wrap_key"
        )
        compliance_wrapped_mek = wrap_mek(mek, compliance_wrap_key)
    else:
        compliance_wrapped_mek = None

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
