"""
Envelope encryption module for the messaging service.

Handles:
- Transport encryption/decryption with ephemeral X25519 keys
- MEK (Message Encryption Key) generation and management
- Envelope encryption for messages using AES-GCM
- MEK wrapping for compliance, sender, and recipient keys
"""

import os
import base64
import logging
from pathlib import Path
from typing import BinaryIO
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes, serialization
from nacl.public import Box, PrivateKey, PublicKey
import nacl.bindings as sodium

logger = logging.getLogger(__name__)

# Nonce/IV sizes
TRANSPORT_NONCE_SIZE = 24  # For X25519 transport encryption (PyNaCl Box/XSalsa20Poly1305)
MEK_NONCE_SIZE = 12        # For AES-GCM content encryption
MEK_SIZE = 32              # Message Encryption Key size

# Client streaming transport format (chunked AES-256-GCM): FCAE | version | frames…
FCAE_MAGIC = b"FCAE"
FCAE_VERSION = 1
FCAE_PREFIX_BYTES = len(FCAE_MAGIC) + 1
FCAE_FRAME_LENGTH_BYTES = 4
TRANSPORT_FILE_KEY_CONTEXT = "fromchat_transport_file_v1"


def generate_mek() -> bytes:
    """Generate a random Message Encryption Key (32 bytes)."""
    return os.urandom(MEK_SIZE)


def generate_nonce(size: int = MEK_NONCE_SIZE) -> bytes:
    """Generate a random nonce for AES-GCM."""
    return os.urandom(size)


def derive_shared_secret(private_key: X25519PrivateKey, peer_public_key_b64: str) -> bytes:
    """
    Compute a shared secret from a private key and peer's public key using X25519.

    Args:
        private_key: X25519PrivateKey
        peer_public_key_b64: Peer's public key in base64 (raw format)

    Returns:
        Shared secret (32 bytes)
    """
    try:
        peer_public_bytes = base64.b64decode(peer_public_key_b64)
        peer_public_key = X25519PublicKey.from_public_bytes(peer_public_bytes)
        return private_key.exchange(peer_public_key)
    except Exception as e:
        logger.error("Failed to derive shared secret: %s", e)
        raise


def derive_key_from_shared_secret(shared_secret: bytes, context: str, key_size: int = MEK_SIZE) -> bytes:
    """
    Derive a key from a shared secret using HKDF-SHA256.
    
    Args:
        shared_secret: The shared secret from ECDH
        context: Context string for key derivation (e.g., "transport_key")
        key_size: Output key size in bytes (default 32)
    
    Returns:
        Derived key bytes
    """
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=key_size,
        salt=b"\x00" * 16,  # 16 zero bytes salt
        info=context.encode(),
    )
    return hkdf.derive(shared_secret)


def decrypt_transport_message(
    client_public_key_b64: str,
    nonce_b64: str,
    ciphertext_b64: str,
    ephemeral_private_key: X25519PrivateKey,
) -> bytes:
    """
    Decrypt a message that was encrypted with the ephemeral public key.

    The client encrypts plaintext with the ephemeral transport key using tweetnacl.box,
    which performs ECDH + XSalsa20Poly1305 encryption.

    Args:
        client_public_key_b64: Client's ephemeral public key (base64, raw X25519)
        nonce_b64: Encryption nonce (base64, 24 bytes for XSalsa20Poly1305)
        ciphertext_b64: Encrypted message (base64)
        ephemeral_private_key: Server's ephemeral X25519 private key

    Returns:
        Decrypted plaintext
    """
    try:
        # Convert cryptography X25519 key to raw bytes
        server_private_bytes = ephemeral_private_key.private_bytes_raw()

        # Convert client public key from base64 to raw bytes
        client_public_bytes = base64.b64decode(client_public_key_b64)

        # Decode nonce and ciphertext
        nonce = base64.b64decode(nonce_b64)
        ciphertext = base64.b64decode(ciphertext_b64)

        # Decrypt using PyNaCl's low-level function (compatible with tweetnacl)
        # Parameters: ciphertext, nonce, sender_public_key, recipient_private_key
        plaintext = sodium.crypto_box_open_easy(
            ciphertext,
            nonce,
            client_public_bytes,  # sender public key
            server_private_bytes  # recipient private key
        )
        return plaintext
    except Exception as e:
        logger.error("Failed to decrypt transport message: %s", e)
        raise


def is_fcae_transport_blob(prefix: bytes) -> bool:
    return len(prefix) >= len(FCAE_MAGIC) and prefix[: len(FCAE_MAGIC)] == FCAE_MAGIC


def derive_transport_file_aes_key(
    client_public_key_b64: str,
    ephemeral_private_key: X25519PrivateKey,
) -> bytes:
    client_public_bytes = base64.b64decode(client_public_key_b64)
    server_private_bytes = ephemeral_private_key.private_bytes_raw()
    shared = sodium.crypto_box_beforenm(client_public_bytes, server_private_bytes)
    return derive_key_from_shared_secret(shared, TRANSPORT_FILE_KEY_CONTEXT)


def _read_fcae_frame_payload(source: BinaryIO) -> tuple[bytes, bytes] | None:
    length_bytes = source.read(FCAE_FRAME_LENGTH_BYTES)
    if not length_bytes:
        return None
    if len(length_bytes) < FCAE_FRAME_LENGTH_BYTES:
        raise ValueError("Truncated FCAE frame length")
    frame_len = int.from_bytes(length_bytes, byteorder="big", signed=False)
    if frame_len <= MEK_NONCE_SIZE:
        raise ValueError("Invalid FCAE frame length")
    frame = source.read(frame_len)
    if len(frame) < frame_len:
        raise ValueError("Truncated FCAE frame")
    iv = frame[:MEK_NONCE_SIZE]
    ciphertext = frame[MEK_NONCE_SIZE:]
    return iv, ciphertext


def _decrypt_fcae_transport_stream_io(
    client_public_key_b64: str,
    source: BinaryIO,
    ephemeral_private_key: X25519PrivateKey,
) -> bytes:
    prefix = source.read(FCAE_PREFIX_BYTES)
    if len(prefix) < FCAE_PREFIX_BYTES:
        raise ValueError("FCAE blob is too short")
    if not is_fcae_transport_blob(prefix):
        raise ValueError("Not an FCAE transport blob")
    if prefix[4] != FCAE_VERSION:
        raise ValueError("Unsupported FCAE version")
    aes_key = derive_transport_file_aes_key(client_public_key_b64, ephemeral_private_key)
    cipher = AESGCM(aes_key)
    parts: list[bytes] = []
    while True:
        frame = _read_fcae_frame_payload(source)
        if frame is None:
            break
        iv, ciphertext = frame
        parts.append(cipher.decrypt(iv, ciphertext, None))
    return b"".join(parts)


def decrypt_fcae_transport_blob_to_file(
    client_public_key_b64: str,
    encrypted_path: Path,
    ephemeral_private_key: X25519PrivateKey,
    output_path: Path,
) -> int:
    """Stream-decrypt FCAE transport ciphertext from disk to a plaintext file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    total_out = 0
    with open(encrypted_path, "rb") as enc, open(output_path, "wb") as out:
        prefix = enc.read(FCAE_PREFIX_BYTES)
        if not is_fcae_transport_blob(prefix):
            raise ValueError("Not an FCAE transport blob")
        if prefix[4] != FCAE_VERSION:
            raise ValueError("Unsupported FCAE version")
        aes_key = derive_transport_file_aes_key(client_public_key_b64, ephemeral_private_key)
        cipher = AESGCM(aes_key)
        while True:
            frame = _read_fcae_frame_payload(enc)
            if frame is None:
                break
            iv, ciphertext = frame
            plain = cipher.decrypt(iv, ciphertext, None)
            out.write(plain)
            total_out += len(plain)
    return total_out


def encrypt_message_to_file(plaintext_path: Path, mek: bytes, output_path: Path) -> str:
    """AES-GCM encrypt a file on disk; returns nonce_b64. Ciphertext written to output_path."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    nonce = generate_nonce(MEK_NONCE_SIZE)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    encryptor = Cipher(algorithms.AES(mek), modes.GCM(nonce)).encryptor()
    with open(plaintext_path, "rb") as src, open(output_path, "wb") as dst:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            dst.write(encryptor.update(chunk))
        dst.write(encryptor.finalize())
    return base64.b64encode(nonce).decode("utf-8")


def decrypt_transport_blob(
    client_public_key_b64: str,
    encrypted_blob: bytes,
    ephemeral_private_key: X25519PrivateKey,
    nonce_size: int = TRANSPORT_NONCE_SIZE,
) -> bytes:
    """
    Decrypt a transport-encrypted binary blob produced by `tweetnacl.box`.

    The client sends a single blob that is `nonce || ciphertext`.
    This function extracts the nonce and decrypts the ciphertext using the server's
    ephemeral transport private key and the client's public key.

    Args:
        client_public_key_b64: Client ephemeral public key in base64 (raw X25519),
            the same key as used for the transport-encrypted message body.
        encrypted_blob: Raw bytes of `nonce || ciphertext`.
        ephemeral_private_key: Server ephemeral X25519 private key.
        nonce_size: Nonce size in bytes (24 for XSalsa20-Poly1305).

    Returns:
        Decrypted plaintext bytes.
    """
    if is_fcae_transport_blob(encrypted_blob):
        import io

        return _decrypt_fcae_transport_stream_io(
            client_public_key_b64,
            io.BytesIO(encrypted_blob),
            ephemeral_private_key,
        )

    if len(encrypted_blob) < nonce_size + 16:
        # crypto_box has a MAC; ciphertext must have at least some overhead.
        raise ValueError("Encrypted blob is too short to contain nonce + ciphertext")

    nonce = encrypted_blob[:nonce_size]
    ciphertext = encrypted_blob[nonce_size:]

    try:
        server_private_bytes = ephemeral_private_key.private_bytes_raw()
        client_public_bytes = base64.b64decode(client_public_key_b64)
        plaintext = sodium.crypto_box_open_easy(
            ciphertext,
            nonce,
            client_public_bytes,  # sender public key
            server_private_bytes,  # recipient private key
        )
        return plaintext
    except Exception as e:
        logger.error("Failed to decrypt transport blob: %s", e)
        raise


def encrypt_message(plaintext: bytes, mek: bytes) -> tuple[str, str]:
    """
    Encrypt plaintext using AES-GCM with a Message Encryption Key.

    Args:
        plaintext: Message content to encrypt
        mek: Message Encryption Key (32 bytes)

    Returns:
        Tuple of (nonce_b64, ciphertext_b64) for storage
    """
    cipher = AESGCM(mek)
    nonce = generate_nonce(MEK_NONCE_SIZE)
    ciphertext = cipher.encrypt(nonce, plaintext, None)
    return base64.b64encode(nonce).decode("utf-8"), base64.b64encode(ciphertext).decode("utf-8")


def decrypt_message(nonce_b64: str, ciphertext_b64: str, mek: bytes) -> bytes:
    """
    Decrypt ciphertext using the MEK.
    
    Args:
        nonce_b64: Base64-encoded nonce
        ciphertext_b64: Base64-encoded ciphertext + tag
        mek: Message Encryption Key (32 bytes)
    
    Returns:
        Plaintext bytes
    """
    try:
        nonce = base64.b64decode(nonce_b64)
        ciphertext = base64.b64decode(ciphertext_b64)
        cipher = AESGCM(mek)
        plaintext = cipher.decrypt(nonce, ciphertext, None)
        return plaintext
    except Exception as e:
        logger.error("Failed to decrypt message: %s", e)
        raise


def wrap_mek(mek: bytes, wrap_key: bytes) -> str:
    """
    Wrap a MEK using a key encryption key (wrap_key).
    Encrypts MEK with AES-256-GCM and returns base64-encoded result.
    
    Args:
        mek: Message Encryption Key to wrap (32 bytes)
        wrap_key: Key to wrap with (32 bytes)
    
    Returns:
        Base64-encoded (nonce + ciphertext + tag)
    """
    cipher = AESGCM(wrap_key)
    nonce = generate_nonce(MEK_NONCE_SIZE)
    ciphertext = cipher.encrypt(nonce, mek, None)
    wrapped = nonce + ciphertext
    return base64.b64encode(wrapped).decode("utf-8")


def unwrap_mek(wrapped_b64: str, wrap_key: bytes) -> bytes:
    """
    Unwrap a MEK using a key encryption key (wrap_key).
    
    Args:
        wrapped_b64: Base64-encoded (nonce + ciphertext + tag)
        wrap_key: Key to unwrap with (32 bytes)
    
    Returns:
        Unwrapped MEK (32 bytes)
    """
    try:
        wrapped = base64.b64decode(wrapped_b64)
        nonce = wrapped[:MEK_NONCE_SIZE]
        ciphertext = wrapped[MEK_NONCE_SIZE:]
        cipher = AESGCM(wrap_key)
        mek = cipher.decrypt(nonce, ciphertext, None)
        return mek
    except Exception as e:
        logger.error("Failed to unwrap MEK: %s", e)
        raise
