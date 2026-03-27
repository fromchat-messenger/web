from __future__ import annotations

import json
import os
from typing import Any, Dict
from urllib.parse import quote


def safe_filename(name: str, max_len: int = 140) -> str:
    base = "".join(c for c in (name or "") if c.isalnum() or c in " ._-()[]{}").strip()
    base = base.replace("  ", " ")
    base = base.replace("/", "_").replace("\\", "_")
    if not base:
        base = "file"
    if len(base) > max_len:
        base = base[:max_len].rstrip()
    return base


def html_escape(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#039;")
    )


def href_escape(rel_path: str) -> str:
    """
    Percent-encode a relative path for use in HTML href/src.
    Keep slashes so nested paths work.
    """
    return quote(rel_path, safe="/")


def guess_is_image(filename: str) -> bool:
    ext = (os.path.splitext(filename or "")[1] or "").lower()
    return ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def parse_message_plaintext(plaintext: str) -> Dict[str, Any]:
    """
    Best-effort parse of decrypted message JSON.

    Returns:
        - kind: "json" | "text"
        - text: best-effort human-readable text
        - raw: original plaintext
        - json: parsed object (if kind=="json")
    """
    raw = plaintext or ""
    try:
        obj = json.loads(raw)
        content = ""
        if isinstance(obj, dict):
            data = obj.get("data")
            if isinstance(data, dict):
                content_val = data.get("content")
                if isinstance(content_val, str):
                    content = content_val
        return {"kind": "json", "text": content or raw, "raw": raw, "json": obj}
    except Exception:
        return {"kind": "text", "text": raw, "raw": raw}

