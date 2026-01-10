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
        client_public_key_b64: Sender public key in base64 (raw X25519).
        encrypted_blob: Raw bytes of `nonce || ciphertext`.
        ephemeral_private_key: Server ephemeral X25519 private key.
        nonce_size: Nonce size in bytes (24 for XSalsa20-Poly1305).

    Returns:
        Decrypted plaintext bytes.
    """
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
