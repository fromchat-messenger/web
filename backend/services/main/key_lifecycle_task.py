"""
Periodic key lifecycle cleanup (compliance MEK, deleted-message keys, edit history).
Poll interval is derived from MESSAGE_RETENTION_DAYS (no separate env var).
"""

import asyncio
import logging

from .db import SessionLocal
from .key_lifecycle import run_key_lifecycle_cleanup

logger = logging.getLogger("uvicorn.error")


def key_lifecycle_poll_seconds() -> int | None:
    try:
        from services.shared.message_retention import get_message_retention
    except ImportError:
        from backend.services.shared.message_retention import get_message_retention  # type: ignore
    r = get_message_retention()
    if not r.cleanup_enabled():
        return None
    sec = r.retention_timedelta().total_seconds()
    # Bound poll: responsive after cutoff without hammering the DB
    return max(15, min(3600, max(1, int(sec / 1000))))


async def start_key_lifecycle_cleanup_task(interval_seconds: int) -> None:
    while True:
        try:
            with SessionLocal() as db:
                run_key_lifecycle_cleanup(db)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Error in key lifecycle cleanup task: %s", e)
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break
            continue
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            break
