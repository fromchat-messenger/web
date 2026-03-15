import asyncio
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import subprocess
import sys
import os
from routes import account, messaging, profile, push, webrtc, devices, moderation, download
import logging
from models import User
from constants import OWNER_USERNAME
from utils import get_client_ip

from db import POOL_CONFIG, SessionLocal
from logging_config import access_logger  # noqa: F401 - ensure loggers configured
from security.audit import log_access
from security.rate_limit import limiter
from slowapi.middleware import SlowAPIMiddleware

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - run migration in subprocess to avoid logging interference
    try:
        logger.info("Starting database migration check...")
        # Run migration in a separate process
        subprocess.run(
            [
                sys.executable, 
                "-c", 
                "import sys; sys.path.append('.'); from migration import run_migrations; run_migrations()"
            ], 
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
    except Exception as e:
        logger.error(f"Failed to run database migrations: {e}")
        raise

    try:
        with SessionLocal() as db:
            owner = db.query(User).filter(User.id == 1).first()
            if owner and not owner.verified:
                owner.verified = True
                db.commit()
                logger.info(f"Owner user '{OWNER_USERNAME}' has been verified")
            elif owner and owner.verified:
                logger.info(f"Owner user '{OWNER_USERNAME}' is already verified")
            else:
                logger.warning(f"Owner user '{OWNER_USERNAME}' not found")
    except Exception as e:
        logger.error(f"Failed to ensure owner verification: {e}")
    
    logger.info(
        "SQLAlchemy pool configured (size=%s, max_overflow=%s, timeout=%ss, recycle=%ss, pre_ping=%s)",
        POOL_CONFIG["pool_size"],
        POOL_CONFIG["max_overflow"],
        POOL_CONFIG["pool_timeout"],
        POOL_CONFIG["pool_recycle"],
        POOL_CONFIG["pool_pre_ping"],
    )

    # Start the messaging cleanup task
    try:
        from routes.messaging import messagingManager
        messagingManager.start_cleanup_task()
        logger.info("Messaging cleanup task started")
    except Exception as e:
        logger.error(f"Failed to start messaging cleanup task: {e}")
    
    # Reset all rate limits on startup to ensure clean state
    # This prevents rate limits from persisting across restarts
    try:
        from security.rate_limit import reset_all_rate_limits
        cleared = reset_all_rate_limits()
        if cleared > 0:
            logger.info(f"Cleared {cleared} rate limit entries on startup")
    except Exception as e:
        logger.warning(f"Failed to reset rate limits on startup: {e}")
    
    # Start the rate limit cleanup task
    try:
        from security.rate_limit import start_rate_limit_cleanup_task
        cleanup_task = asyncio.create_task(start_rate_limit_cleanup_task())
        logger.info("Rate limit cleanup task started")
    except Exception as e:
        logger.error(f"Failed to start rate limit cleanup task: {e}")
        cleanup_task = None
    
    yield
    
    # Shutdown - cancel cleanup task if it exists
    if cleanup_task:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass

# Инициализация FastAPI
app = FastAPI(title="FromChat", lifespan=lifespan)

# Add rate limiting middleware
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.middleware("http")
async def access_logging_middleware(request: Request, call_next):
    # Log incoming request and Authorization header presence for debugging auth issues
    try:
        auth_header = request.headers.get("authorization")
        if auth_header:
            short = auth_header[:20] + "..." if len(auth_header) > 20 else auth_header
            logger.info("Incoming request %s %s Authorization=%s", request.method, request.url.path, short)
        else:
            logger.info("Incoming request %s %s Authorization=NONE", request.method, request.url.path)
    except Exception:
        pass
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        duration = time.perf_counter() - start
        user = getattr(getattr(request, "state", None), "current_user", None)
        log_access(
            "http_error",
            method=request.method,
            path=request.url.path,
            status="error",
            user=getattr(user, "username", None),
            ip=get_client_ip(request),
            duration=f"{duration:.3f}s",
            error=str(exc),
        )
        raise
    else:
        duration = time.perf_counter() - start
        user = getattr(getattr(request, "state", None), "current_user", None)
        log_access(
            "http_request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            user=getattr(user, "username", None),
            ip=get_client_ip(request),
            duration=f"{duration:.3f}s",
        )
        return response


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://fromchat.ru",
        "https://beta.fromchat.ru",
        "https://www.fromchat.ru",
        "http://127.0.0.1:8301",
        "http://127.0.0.1:8300",
        "http://localhost:8301",
        "http://localhost:8300",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(account.router)
app.include_router(messaging.router)
app.include_router(profile.router)
app.include_router(push.router, prefix="/push")
app.include_router(webrtc.router, prefix="/webrtc")
app.include_router(devices.router, prefix="/devices")
app.include_router(moderation.router)
app.include_router(download.router)