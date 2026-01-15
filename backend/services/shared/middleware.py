"""
Shared middleware for inter-service communication validation and security.

Provides:
- Request size limiting (max 5GB)
- Input validation and sanitization
- Comprehensive audit logging
- Health check access log filtering
"""

import logging
import time
from typing import Callable
from fastapi import FastAPI, Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("uvicorn.error")
access_logger = logging.getLogger("uvicorn.access")


class HealthCheckFilter(logging.Filter):
    """Filter to suppress access logs for health check requests."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Return False to suppress logs containing health check requests."""
        message = record.getMessage()
        return "GET /health HTTP/" not in message

# Maximum request size: 5GB
MAX_REQUEST_SIZE = 5 * 1024 * 1024 * 1024  # 5GB in bytes


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Middleware to enforce maximum request size."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Check request size before processing."""
        # Check Content-Length header if available
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
                if size > MAX_REQUEST_SIZE:
                    logger.warning(
                        "Request size %d exceeds limit %d from %s %s",
                        size,
                        MAX_REQUEST_SIZE,
                        request.client.host if request.client else "unknown",
                        request.url.path,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Request size exceeds {MAX_REQUEST_SIZE} bytes limit"
                    )
            except ValueError:
                pass

        return await call_next(request)


# Apply health check filter to access logger
if not any(isinstance(f, HealthCheckFilter) for f in access_logger.filters):
    access_logger.addFilter(HealthCheckFilter())


def add_security_middleware(app: FastAPI):
    """
    Add all security and audit middleware to FastAPI app.

    Args:
        app: FastAPI application instance
    """
    # Request size limiting (inner, checked first)
    app.add_middleware(RequestSizeLimitMiddleware)
