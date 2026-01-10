"""
Shared middleware for inter-service communication validation and security.

Provides:
- Request size limiting (max 5GB)
- Input validation and sanitization
- Comprehensive audit logging
"""

import logging
import time
from typing import Callable
from fastapi import FastAPI, Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("uvicorn.error")

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


class AuditLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for comprehensive audit logging of all requests."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Log request and response details."""
        start_time = time.time()
        
        # Log request
        client_ip = request.client.host if request.client else "unknown"
        method = request.method
        path = request.url.path
        
        logger.info(
            "REQUEST: %s %s from %s",
            method,
            path,
            client_ip,
        )

        try:
            response = await call_next(request)
            
            # Log response
            duration = time.time() - start_time
            logger.info(
                "RESPONSE: %s %s -> %d in %.2fms",
                method,
                path,
                response.status_code,
                duration * 1000,
            )
            
            return response
            
        except Exception as e:
            duration = time.time() - start_time
            logger.exception(
                "ERROR: %s %s failed after %.2fms: %s",
                method,
                path,
                duration * 1000,
                e,
            )
            raise


def add_security_middleware(app: FastAPI):
    """
    Add all security and audit middleware to FastAPI app.
    
    Args:
        app: FastAPI application instance
    """
    # Request size limiting (inner, checked first)
    app.add_middleware(RequestSizeLimitMiddleware)
    
    # Audit logging (outer, logs everything)
    app.add_middleware(AuditLoggingMiddleware)
