from __future__ import annotations

import json
from typing import Any, Dict, Optional
from urllib import error, request
from urllib.parse import quote


def http_get_bytes(url: str, token: str, timeout_seconds: float = 30.0) -> bytes:
    req = request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as r:
            return r.read()
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        raise RuntimeError(f"HTTP {e.code} for {url}: {body[:500]}")


def http_get_json(url: str, token: str, timeout_seconds: float = 30.0) -> Dict[str, Any]:
    raw = http_get_bytes(url, token, timeout_seconds=timeout_seconds)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"Failed to parse JSON from {url}: {e}")


def http_post_json(
    url: str,
    body: Dict[str, Any],
    *,
    token: Optional[str] = None,
    timeout_seconds: float = 30.0,
) -> Dict[str, Any]:
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, method="POST", data=payload)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as r:
            raw = r.read()
    except error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        raise RuntimeError(f"HTTP {e.code} for {url}: {body_txt[:500]}")

    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"Failed to parse JSON from {url}: {e}")


def join_api_url(api_base_url: str, path: str) -> str:
    """
    Join an API base URL (usually ends with '/api') with a path that may start with:
    - '/api/...'
    - '/uploads/...'
    - 'uploads/...'
    """
    base = api_base_url.rstrip("/")
    p = (path or "").strip()
    if p.startswith("http://") or p.startswith("https://"):
        return p

    p_quoted = quote(p, safe="/:?&=%")

    if p.startswith("/api/"):
        origin = base[:-4] if base.endswith("/api") else base
        return origin.rstrip("/") + p_quoted

    if not p.startswith("/"):
        p_quoted = "/" + p_quoted
    return base + p_quoted

