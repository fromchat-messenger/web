"""
Per-IP rate limits for internal FastAPI apps (messaging, file_storage).

Complements the main service's endpoint-specific limits. Uses a generous default
because traffic is mostly from the main backend (single Docker bridge IP).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address


def _client_ip_key(request: Request) -> str:
    if request is None:
        return "unknown"
    headers = request.headers
    real = (headers.get("x-real-ip") or headers.get("X-Real-IP") or "").strip()
    if real:
        return real
    forwarded = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return get_remote_address(request)


def attach_internal_service_rate_limit(
    app: FastAPI,
    *,
    default_limit: str = "6000/minute",
) -> Limiter:
    """
    Register SlowAPI on ``app`` with a default limit for all routes.
    Use ``@limiter.exempt`` on ``/health`` (and similar) so probes are not throttled.
    """
    limiter = Limiter(
        key_func=_client_ip_key,
        default_limits=[default_limit],
        storage_uri="memory://",
    )
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    return limiter
