from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..utils import get_client_ip

logger = logging.getLogger("uvicorn.error")

def get_ip_key(request: Request) -> str:
    """Get rate limit key based on IP address."""
    return get_client_ip(request) or get_remote_address(request)

# Initialize limiter with IP-based key function
# Note: We don't set default_limits to avoid affecting all users if one IP is attacked.
# Each endpoint should have an explicit rate limit based on its sensitivity.
# Rate limits automatically expire after the time window - IPs are not permanently blocked.
limiter = Limiter(
    key_func=get_ip_key,
    default_limits=[],  # No global default - each endpoint must have explicit limits
    storage_uri="memory://",  # In-memory storage (can be changed to Redis later)
)


# Rate limit decorator for IP-based limiting
def rate_limit_per_ip(limit: str) -> Callable:
    """Rate limit based on IP address."""
    return limiter.limit(limit, key_func=get_ip_key)


def _get_storage_dict(storage) -> dict | None:
    """Get the internal storage dictionary from slowapi's memory storage."""
    if hasattr(storage, "_storage") and isinstance(storage._storage, dict):
        return storage._storage
    elif hasattr(storage, "storage") and isinstance(storage.storage, dict):
        return storage.storage
    return None


def reset_all_rate_limits() -> int:
    """
    Reset all rate limits by clearing the storage.
    This should be called on startup to ensure a clean state.
    Returns the number of entries cleared.
    """
    try:
        # Access the private _storage attribute
        storage = limiter._storage
        storage_dict = _get_storage_dict(storage)
        
        if storage_dict is None:
            # Try using the storage's reset method if available
            if hasattr(storage, "reset"):
                try:
                    # Try reset() with no args first (clears all)
                    storage.reset()
                    logger.info("Reset all rate limits on startup using storage.reset()")
                    return 1  # Assume it worked
                except TypeError:
                    # reset() might require arguments, try clearing differently
                    try:
                        # Some storage backends need explicit clearing
                        if hasattr(storage, "clear"):
                            storage.clear()
                            logger.info("Reset all rate limits on startup using storage.clear()")
                            return 1
                    except Exception:
                        pass
                except Exception:
                    pass
            logger.warning("Could not reset rate limits: storage dict not accessible and no reset method")
            return 0
        
        count = len(storage_dict)
        if count > 0:
            storage_dict.clear()
            logger.info(f"Reset all rate limits on startup: cleared {count} entries")
        return count
    except Exception as e:
        logger.warning(f"Failed to reset rate limits on startup: {e}")
        return 0


def reset_rate_limit_for_ip(ip: str) -> bool:
    """
    Manually reset rate limit for a specific IP address.
    This clears all rate limit entries for the given IP.
    Returns True if any entries were cleared, False otherwise.
    """
    if not ip:
        return False
    
    try:
        # Access the private _storage attribute
        storage = limiter._storage
        storage_dict = _get_storage_dict(storage)
        
        if storage_dict is None:
            # Try alternative methods
            if hasattr(storage, "reset"):
                try:
                    storage.reset(ip)
                    return True
                except Exception:
                    pass
            return False
        
        cleared = False
        # slowapi stores entries with keys like "LIMITER:{ip}:{endpoint}"
        # We need to find all keys that contain this IP
        # Also handle cases where IP might be in different positions
        keys_to_remove = []
        
        for key in list(storage_dict.keys()):
            if isinstance(key, str):
                # Check multiple patterns:
                # - "LIMITER:{ip}:{endpoint}"
                # - Keys containing the IP anywhere
                # - Keys starting with the IP
                if (key.startswith(f"LIMITER:{ip}:") or 
                    key.startswith(f"LIMITER:{ip}") or
                    f":{ip}:" in key or
                    key.endswith(f":{ip}") or
                    (ip in key and "LIMITER" in key)):
                    keys_to_remove.append(key)
        
        for key in keys_to_remove:
            try:
                del storage_dict[key]
                cleared = True
                logger.info(f"Cleared rate limit key: {key}")
            except KeyError:
                pass
        
        if cleared:
            logger.info(f"Successfully cleared rate limits for IP: {ip}")
        else:
            logger.warning(f"No rate limit entries found for IP: {ip}")
        
        return cleared
    except Exception as e:
        logger.warning(f"Failed to reset rate limit for IP {ip}: {e}")
        return False


def clear_all_rate_limits() -> int:
    """
    Clear all rate limit entries. Use with caution - this affects all IPs.
    Returns the number of entries cleared.
    """
    try:
        # Access the private _storage attribute
        storage = limiter._storage
        storage_dict = _get_storage_dict(storage)
        
        if storage_dict is None:
            return 0
        
        count = len(storage_dict)
        storage_dict.clear()
        logger.warning(f"Cleared all {count} rate limit entries")
        return count
    except Exception as e:
        logger.error(f"Failed to clear all rate limits: {e}")
        return 0


def cleanup_expired_rate_limits() -> int:
    """
    Clean up expired rate limit entries from memory storage.
    This helps prevent rate limits from being stuck indefinitely.
    Returns the number of entries cleaned up.
    """
    try:
        # Access the private _storage attribute
        storage = limiter._storage
        storage_dict = _get_storage_dict(storage)
        
        if storage_dict is None:
            return 0
        
        # slowapi's memory storage stores entries as tuples: (count, reset_time)
        # Entries should expire naturally, but we'll clean up any that are clearly expired
        now = time.time()
        cleaned = 0
        keys_to_remove = []
        
        for key, value in storage_dict.items():
            if isinstance(value, (tuple, list)) and len(value) >= 2:
                # Check if reset_time has passed (with some buffer)
                reset_time = value[1] if isinstance(value[1], (int, float)) else 0
                # Add 60 second buffer to ensure we don't remove active entries
                if reset_time > 0 and now > (reset_time + 60):
                    keys_to_remove.append(key)
            elif isinstance(value, dict):
                # Some storage formats use dicts with 'expiry' or 'reset' fields
                expiry = value.get("expiry") or value.get("reset") or value.get("reset_time")
                if expiry and isinstance(expiry, (int, float)) and now > (expiry + 60):
                    keys_to_remove.append(key)
        
        for key in keys_to_remove:
            try:
                del storage_dict[key]
                cleaned += 1
            except KeyError:
                pass
        
        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} expired rate limit entries")
        
        return cleaned
    except Exception as e:
        logger.warning(f"Failed to cleanup expired rate limits: {e}")
        return 0


async def start_rate_limit_cleanup_task() -> None:
    """Start a background task to periodically clean up expired rate limit entries."""
    while True:
        try:
            await asyncio.sleep(300)  # Run every 5 minutes
            cleanup_expired_rate_limits()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in rate limit cleanup task: {e}")
            await asyncio.sleep(60)  # Wait 1 minute before retrying