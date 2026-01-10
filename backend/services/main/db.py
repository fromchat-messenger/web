import os
from typing import Generator, Optional

import time
import logging
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import OperationalError

from .constants import DATABASE_URL

logger = logging.getLogger(__name__)

"""
Universal database interface that provides identical behavior for PostgreSQL and SQLite.

Features:
- Auto-creates parent directory for SQLite files.
- Applies SQLite pragmas (foreign_keys=ON, journal_mode=WAL) for improved compatibility.
- Uses StaticPool for in-memory or file-based SQLite when appropriate.
- Exposes `engine`, `SessionLocal`, `get_db` dependency, and `POOL_CONFIG`.
"""

# Ensure parent directory exists for SQLite file DBs
def _ensure_sqlite_parent_dir(url: str) -> None:
    if not url or not url.startswith("sqlite"):
        return
    # strip sqlite:/// prefix
    path = url.replace("sqlite:///", "", 1)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


# Pool and engine configuration (tunable via env)
POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "40"))
POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", "1800"))
POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "30"))

POOL_CONFIG = {
    "pool_size": POOL_SIZE,
    "max_overflow": MAX_OVERFLOW,
    "pool_recycle": POOL_RECYCLE,
    "pool_timeout": POOL_TIMEOUT,
    "pool_pre_ping": True,
}


def get_engine(database_url: Optional[str] = None) -> Engine:
    """
    Create and return a SQLAlchemy Engine configured for the given database URL.
    This function ensures SQLite-specific pragmas and connection args are applied.
    Includes retry logic for database connection failures during startup.
    """
    url = database_url or DATABASE_URL
    _ensure_sqlite_parent_dir(url)

    # Retry database connection during startup (helps with Docker initialization timing)
    if url.startswith("postgresql"):
        max_retries = 15
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting database connection (attempt {attempt + 1}/{max_retries})...")
                # Test the connection by creating engine and trying to connect
                test_engine = create_engine(url, pool_size=1, max_overflow=0, pool_timeout=5, future=True)
                with test_engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                test_engine.dispose()
                logger.info("Database connection successful")
                break
            except OperationalError as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Database connection failed (attempt {attempt + 1}): {e}")
                    time.sleep(retry_delay)
                else:
                    logger.error(f"Database connection failed after {max_retries} attempts: {e}")
                    raise
            except Exception as e:
                logger.error(f"Unexpected error during database connection: {e}")
                raise

    if url.startswith("sqlite"):
        # For SQLite file-based DBs, use standard pooling but set connection timeout and pragmas.
        # Use StaticPool only for in-memory SQLite.
        in_memory = url in ("sqlite:///:memory:", "sqlite://")
        connect_args = {"check_same_thread": False, "timeout": int(os.getenv("SQLITE_BUSY_TIMEOUT", "5"))}

        if in_memory:
            engine = create_engine(url, connect_args=connect_args, poolclass=StaticPool, future=True)
        else:
            engine = create_engine(url, connect_args=connect_args, future=True)

        # Apply pragmas on connect for SQLite (foreign keys, WAL, busy_timeout)
        @event.listens_for(engine, "connect")
        def _sqlite_on_connect(dbapi_conn, connection_record):
            try:
                cursor = dbapi_conn.cursor()
                cursor.execute("PRAGMA foreign_keys = ON")
                cursor.execute("PRAGMA journal_mode = WAL")
                # busy_timeout in milliseconds
                busy_ms = int(os.getenv("SQLITE_BUSY_TIMEOUT_MS", "5000"))
                cursor.execute(f"PRAGMA busy_timeout = {busy_ms}")
                cursor.close()
            except Exception:
                # Best-effort; do not fail engine creation if pragmas cannot be set
                pass

        return engine

    # Default for Postgres / MySQL etc. - use pool sizing from env
    engine_kwargs = {
        "pool_size": POOL_SIZE,
        "max_overflow": MAX_OVERFLOW,
        "pool_recycle": POOL_RECYCLE,
        "pool_timeout": POOL_TIMEOUT,
        "future": True,
    }
    return create_engine(url, **engine_kwargs)


# Create global engine and session factory for convenient imports
engine = get_engine()
# Keep loaded attributes available after commit/close to avoid DetachedInstanceError
SessionLocal = sessionmaker(class_=Session, autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)


def init_db(create_tables: bool = False, base_metadata=None) -> None:
    """
    Initialize the database. If `create_tables` is True and `base_metadata` is provided,
    create all tables using the provided SQLAlchemy metadata.
    """
    if create_tables:
        if base_metadata is None:
            raise ValueError("base_metadata is required to create tables")
        base_metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a SQLAlchemy Session and ensures proper close().
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.close()
        except Exception:
            pass