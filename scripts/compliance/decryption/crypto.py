from __future__ import annotations

import base64
import os
from typing import Any, Dict, Iterable, Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def load_compliance_private_key(key_file: str = "compliance_keypair.txt") -> X25519PrivateKey:
    if not os.path.exists(key_file):
        raise FileNotFoundError(f"Compliance key file not found: {key_file}")

    with open(key_file, "r", encoding="utf-8") as f:
        content = f.read()

    private_key_b64: Optional[str] = None
    for line in content.split("\n"):
        line = line.strip()
        # Look for PRIVATE_KEY= line or base64 lines that are exactly 43 chars (X25519 private key length when base64 encoded)
        if line.startswith("PRIVATE_KEY="):
            private_key_b64 = line.split("=", 1)[1].strip()
            break
        elif len(line) == 43 and line.endswith("=") and "=" in line:  # Base64 X25519 private key
            private_key_b64 = line
            break

    if not private_key_b64:
        raise ValueError(f"Could not find private key in {key_file}. Expected PRIVATE_KEY= line or 43-character base64 string.")

    private_key_bytes = base64.b64decode(private_key_b64)
    return X25519PrivateKey.from_private_bytes(private_key_bytes)


def _hkdf_32(info: bytes) -> HKDF:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"\x00" * 16,
        info=info,
    )


def derive_wrap_key_from_public_key_bytes(public_key_bytes: bytes, context: str) -> bytes:
    return _hkdf_32(context.encode("utf-8")).derive(public_key_bytes)


def derive_compliance_wrap_key(compliance_public_key: X25519PublicKey) -> bytes:
    return _hkdf_32(b"compliance_wrap_key").derive(compliance_public_key.public_bytes_raw())


def decrypt_compliance_mek(
    wrapped_mek_b64: str,
    compliance_private_key: X25519PrivateKey,
    compliance_public_key: X25519PublicKey,
) -> bytes:
    wrap_key = derive_compliance_wrap_key(compliance_public_key)
    wrapped_mek_bytes = base64.b64decode(wrapped_mek_b64)
    nonce = wrapped_mek_bytes[:12]
    ciphertext = wrapped_mek_bytes[12:]
    aesgcm = AESGCM(wrap_key)
    return aesgcm.decrypt(nonce, ciphertext, None)


def decrypt_wrapped_mek_with_public_key(wrapped_mek_b64: str, wrap_public_key_b64: str, wrap_context: str) -> bytes:
    public_key_bytes = base64.b64decode(wrap_public_key_b64)
    wrap_key = derive_wrap_key_from_public_key_bytes(public_key_bytes, wrap_context)
    wrapped_mek_bytes = base64.b64decode(wrapped_mek_b64)
    nonce = wrapped_mek_bytes[:12]
    ciphertext = wrapped_mek_bytes[12:]
    aesgcm = AESGCM(wrap_key)
    return aesgcm.decrypt(nonce, ciphertext, None)


def first_present_key(data: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    for k in keys:
        v = data.get(k)
        if v is None:
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return k
    return None


def get_str(data: Dict[str, Any], keys: Iterable[str], label: str) -> str:
    k = first_present_key(data, keys)
    if not k:
        raise ValueError(f"Missing {label}. Expected one of: {', '.join(keys)}")
    v = data.get(k)
    if not isinstance(v, str):
        raise ValueError(f"Invalid {label}: expected string at '{k}', got {type(v).__name__}")
    return v


def decrypt_message(envelope_data: Dict[str, Any], compliance_private_key: X25519PrivateKey, compliance_public_key: X25519PublicKey) -> str:
    compliance_wrapped_mek = envelope_data.get("compliance_wrapped_mek_b64")
    if not compliance_wrapped_mek:
        raise ValueError("Message does not have compliance MEK")

    mek = decrypt_compliance_mek(compliance_wrapped_mek, compliance_private_key, compliance_public_key)

    nonce_b64 = envelope_data["iv_b64"]
    ciphertext_b64 = envelope_data["ciphertext_b64"]

    nonce = base64.b64decode(nonce_b64)
    ciphertext = base64.b64decode(ciphertext_b64)

    aesgcm = AESGCM(mek)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


def decrypt_file_bytes_from_meta(meta: Dict[str, Any], encrypted_bytes: bytes, *, key_file: str = "compliance_keypair.txt") -> bytes:
    nonce_b64 = get_str(meta, keys=["nonce_b64", "iv_b64", "nonce", "iv"], label="nonce/iv (base64)")
    nonce = base64.b64decode(nonce_b64)

    mek_key = first_present_key(meta, ["compliance_wrapped_mek_b64", "compliance_wrapped_mek"])
    if mek_key:
        compliance_private_key = load_compliance_private_key(key_file=key_file)
        compliance_public_key = compliance_private_key.public_key()
        mek = decrypt_compliance_mek(str(meta[mek_key]), compliance_private_key, compliance_public_key)
    else:
        wrap_public_key_b64 = get_str(
            meta,
            keys=["wrap_public_key_b64", "wrap_public_key", "public_key_b64"],
            label="wrap public key (base64)",
        )
        wrap_context = get_str(meta, keys=["wrap_context"], label="wrap context")
        wrapped_mek_b64 = get_str(meta, keys=["wrapped_mek_b64", "wrapped_mek"], label="wrapped MEK (base64)")
        mek = decrypt_wrapped_mek_with_public_key(wrapped_mek_b64, wrap_public_key_b64, wrap_context)

    aesgcm = AESGCM(mek)
    return aesgcm.decrypt(nonce, encrypted_bytes, None)


def derive_auth_secret(username: str, password: str) -> str:
    """
    Match frontend `deriveAuthSecret()`:
    HKDF-SHA256 with:
        - IKM: UTF-8 password
        - salt: UTF-8 `fromchat.user:{username}`
        - info: UTF-8 `auth-secret`
        - length: 32 bytes
    Output: base64 string.
    """
    salt = f"fromchat.user:{(username or '').strip()}".encode("utf-8")
    info = b"auth-secret"
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        info=info,
    )
    derived = hkdf.derive((password or "").encode("utf-8"))
    return base64.b64encode(derived).decode("ascii")

