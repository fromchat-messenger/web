"""
File Storage Service - Secure file storage with execution prevention.

This service handles all file storage operations with non-executable permissions
and secure directory configuration to prevent code execution regardless of file content.
"""

import logging
import json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

logger = logging.getLogger("uvicorn.error")

# File storage has no database access - trusts main backend for authentication

# Lifespan context for startup/shutdown tasks (modern FastAPI pattern)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure directories exist and permissions are applied before serving requests
    _ensure_dirs()
    _load_permissions()
    logger.info("File storage initialized at %s", str(FILES_DIR.resolve()))
    yield

# Initialize FastAPI app for file storage service with lifespan
app = FastAPI(
    title="FromChat File Storage Service",
    description="Secure file storage service with execution prevention",
    version="1.0.0",
    lifespan=lifespan,
)

# Add security middleware
try:
    from services.shared.middleware import add_security_middleware
except ImportError:
    try:
        from backend.services.shared.middleware import add_security_middleware
    except ImportError:
        add_security_middleware = None

if add_security_middleware:
    add_security_middleware(app)

try:
    from services.shared.inter_service_rate_limit import attach_internal_service_rate_limit
except ImportError:
    from backend.services.shared.inter_service_rate_limit import attach_internal_service_rate_limit  # type: ignore

_internal_limiter = attach_internal_service_rate_limit(app, default_limit="5000/minute")

# CORS configuration for inter-service communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for inter-service communication
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=None)
@_internal_limiter.exempt
async def health_check():
    """Health check endpoint for file storage service."""
    return {"status": "healthy", "service": "file_storage"}


@app.get("/", response_model=None)
async def root():
    """Root endpoint for file storage service."""
    return {"message": "FromChat File Storage Service", "status": "operational"}


"""
File storage implementation
- Stores files under `files/files`
- Ensures directories and files have non-executable permissions
- Simple internal auth via X-Internal-Auth header when INTERNAL_AUTH_TOKEN is set
- Streams uploads to disk to avoid large memory usage
"""

import os
import base64
import uuid
import time
from pathlib import Path
from typing import Optional
from fastapi import UploadFile, File, HTTPException, Request, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

# File serving directories (matching main service structure)
FILES_BASE_DIR = Path("data/uploads/files")
FILES_NORMAL_DIR = FILES_BASE_DIR / "normal"
FILES_ENCRYPTED_DIR = FILES_BASE_DIR / "encrypted"

# Base storage directories
BASE_DIR = Path("files")
FILES_DIR = BASE_DIR / "files"
THUMBS_DIR = BASE_DIR / "thumbs"
TMP_DIR = BASE_DIR / "tmp"
RESUMABLE_DIR = TMP_DIR / "resumable"
RESUMABLE_META_DIR = RESUMABLE_DIR / "meta"
RESUMABLE_DATA_DIR = RESUMABLE_DIR / "data"

# Maximum allowed upload size (bytes) - 5GB per plan
MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024

# Permissions storage
PERMISSIONS_FILE = Path("files/permissions.json")
_file_permissions: dict[str, list[int]] = {}


def _load_permissions():
    """Load permissions from disk."""
    global _file_permissions
    if PERMISSIONS_FILE.exists():
        try:
            with open(PERMISSIONS_FILE, 'r') as f:
                _file_permissions = json.load(f)
        except Exception as e:
            logger.error("Failed to load permissions file: %s", e)
            _file_permissions = {}


def _save_permissions():
    """Save permissions to disk."""
    try:
        with open(PERMISSIONS_FILE, 'w') as f:
            json.dump(_file_permissions, f, indent=2)
    except Exception as e:
        logger.error("Failed to save permissions file: %s", e)


def _store_file_permissions(file_id: str, allowed_user_ids: list[int]):
    """Store permission information for a file."""
    _file_permissions[file_id] = allowed_user_ids
    _save_permissions()


def _check_file_permissions(file_id: str, user_id: int) -> bool:
    """Check if user has permission to access a file."""
    allowed_users = _file_permissions.get(file_id, [])
    return user_id in allowed_users


def _ensure_dirs() -> None:
    """Create storage directories with secure permissions (owner rw, no exec for files)."""
    os.makedirs(FILES_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(RESUMABLE_META_DIR, exist_ok=True)
    os.makedirs(RESUMABLE_DATA_DIR, exist_ok=True)
    # Also ensure the uploads directories exist (for backward compatibility)
    os.makedirs(FILES_NORMAL_DIR, exist_ok=True)
    os.makedirs(FILES_ENCRYPTED_DIR, exist_ok=True)
    try:
        # Directories should be accessible only by owner
        os.chmod(BASE_DIR, 0o700)
        os.chmod(FILES_DIR, 0o700)
        os.chmod(TMP_DIR, 0o700)
        os.chmod(RESUMABLE_DIR, 0o700)
        os.chmod(RESUMABLE_META_DIR, 0o700)
        os.chmod(RESUMABLE_DATA_DIR, 0o700)
        os.chmod(FILES_BASE_DIR, 0o700)
        os.chmod(FILES_NORMAL_DIR, 0o700)
        os.chmod(FILES_ENCRYPTED_DIR, 0o700)
        os.makedirs(THUMBS_DIR, exist_ok=True)
        os.chmod(THUMBS_DIR, 0o700)
    except Exception:
        # Best-effort; don't fail startup if chmod not permitted
        logger.debug("Could not set directory permissions for file storage (best-effort)")


# No internal auth enforced by design (accept all uploads). Authentication is handled by main service.


# startup tasks are handled by the lifespan context manager above


def _secure_filename(name: str) -> str:
    """Return a sanitized filename (strip directories)."""
    return Path(name).name


def _resumable_meta_path(upload_id: str) -> Path:
    return RESUMABLE_META_DIR / f"{upload_id}.json"


def _resumable_data_path(upload_id: str) -> Path:
    return RESUMABLE_DATA_DIR / f"{upload_id}.bin"


def _read_resumable_meta(upload_id: str) -> dict:
    meta_path = _resumable_meta_path(upload_id)
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error("STORAGE: Failed to read resumable metadata for %s: %s", upload_id, e)
        raise HTTPException(status_code=500, detail="Failed to read upload session")


def _write_resumable_meta(upload_id: str, data: dict) -> None:
    meta_path = _resumable_meta_path(upload_id)
    tmp_path = meta_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=True), encoding="utf-8")
    os.replace(tmp_path, meta_path)


def _assert_resumable_access(meta: dict, user_id: int) -> None:
    allowed = meta.get("allowed_user_ids", [])
    if user_id == 1:
        return
    if user_id not in allowed:
        raise HTTPException(status_code=403, detail="Access denied to this upload")


async def _stream_save(upload: UploadFile, dest_path: Path) -> int:
    """Stream an UploadFile to disk, return total bytes written."""
    total = 0
    # write to a temp file first
    tmp_name = TMP_DIR / f"{uuid.uuid4().hex}.tmp"
    try:
        with open(tmp_name, "wb") as out:
            while True:
                chunk = await upload.read(64 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                total += len(chunk)
                if total > MAX_UPLOAD_SIZE:
                    raise HTTPException(status_code=400, detail="File exceeds maximum allowed size")
        # Move into place
        os.replace(tmp_name, dest_path)
        # Ensure non-executable permissions for file (rw for owner only)
        try:
            os.chmod(dest_path, 0o600)
        except Exception:
            logger.debug("Could not chmod file %s", dest_path)
        return total
    finally:
        # Cleanup tmp if still exists
        try:
            if tmp_name.exists():
                tmp_name.unlink()
        except Exception:
            pass


@app.post("/upload", response_model=None)
async def upload_file(request: Request, file: UploadFile = File(...)):
    """
    Upload a file to secure storage. Returns the stored filename and path.

    """
    try:
        # Ensure directories exist even when called in-process (lifespan may not run for mounted apps).
        _ensure_dirs()

        original_name = _secure_filename(file.filename or "file")
        uid = uuid.uuid4().hex
        stored_name = f"{uid}_{original_name}"
        dest = FILES_DIR / stored_name

        logger.info(
            "STORAGE: Uploading file original_name=%s stored_name=%s from %s",
            original_name,
            stored_name,
            request.client.host if request.client else "unknown",
        )

        size = await _stream_save(file, dest)

        logger.info(
            "STORAGE: File upload successful, size=%d bytes, path=%s",
            size,
            stored_name,
        )

        return {
            "status": "success",
            "filename": stored_name,
            "original_name": original_name,
            "size": int(size),
            "path": f"/files/{stored_name}",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("STORAGE: Failed to save upload: %s", e)
        raise HTTPException(status_code=500, detail="Failed to store file")


async def upload_base64_internal(
    filename: str,
    data_b64: str,
    content_type: str = "application/octet-stream",
    allowed_user_ids: list[int] | None = None,
) -> dict:
    """Internal implementation for base64 upload. Used by both HTTP route and in-process calls."""
    allowed_user_ids = allowed_user_ids or []
    try:
        if not data_b64:
            raise HTTPException(status_code=400, detail="data_b64 is required")

        _ensure_dirs()

        file_data = base64.b64decode(data_b64)
        original_name = _secure_filename(filename or "file")
        uid = uuid.uuid4().hex
        stored_name = f"{uid}_{original_name}"
        dest = FILES_DIR / stored_name
        dest.parent.mkdir(parents=True, exist_ok=True)

        logger.info(
            "STORAGE: Uploading base64 file original_name=%s stored_name=%s size=%d bytes",
            original_name,
            stored_name,
            len(file_data),
        )

        # Write file data
        with open(dest, "wb") as f:
            f.write(file_data)

        # Apply secure permissions (no execute, owner read/write only)
        dest.chmod(0o600)

        # Store permission information
        _store_file_permissions(stored_name, allowed_user_ids)

        logger.info(
            "STORAGE: Base64 file upload successful, size=%d bytes, path=%s, allowed_users=%s",
            len(file_data),
            stored_name,
            allowed_user_ids,
        )

        return {
            "file_id": stored_name,
            "filename": original_name,
            "size": len(file_data),
            "path": f"/uploads/files/encrypted/{stored_name}",
        }

    except Exception as e:
        logger.exception("STORAGE: Base64 file upload failed: %s", e)
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")


@app.post("/upload-base64", response_model=None)
async def upload_base64_file(request: Request):
    """
    Upload a base64-encoded file to secure storage.
    Expects JSON payload: {"filename": str, "data_b64": str, "content_type": str?, "allowed_user_ids": [int]}
    """
    payload = await request.json()
    return await upload_base64_internal(
        filename=payload.get("filename", "file"),
        data_b64=payload.get("data_b64", ""),
        content_type=payload.get("content_type", "application/octet-stream"),
        allowed_user_ids=payload.get("allowed_user_ids", []),
    )


async def init_resumable_upload_internal(
    filename: str,
    total_size: int,
    allowed_user_ids: list[int],
    chunk_size: int | None = None,
) -> dict:
    """Internal implementation for in-process calls."""
    chunk_size = chunk_size if chunk_size and chunk_size > 0 else 262_144
    if total_size <= 0:
        raise HTTPException(status_code=400, detail="total_size must be > 0")
    if total_size > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds maximum allowed size")
    if not allowed_user_ids:
        raise HTTPException(status_code=400, detail="allowed_user_ids is required")

    _ensure_dirs()

    upload_id = uuid.uuid4().hex
    meta = {
        "upload_id": upload_id,
        "filename": _secure_filename(filename),
        "total_size": total_size,
        "offset": 0,
        "complete": False,
        "chunk_size": chunk_size,
        "allowed_user_ids": allowed_user_ids,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    _write_resumable_meta(upload_id, meta)
    _resumable_data_path(upload_id).write_bytes(b"")

    logger.info(
        "STORAGE: Resumable init upload_id=%s filename=%s size=%s allowed=%s",
        upload_id,
        meta["filename"],
        total_size,
        allowed_user_ids,
    )

    return {
        "upload_id": upload_id,
        "chunk_size": chunk_size,
        "offset": 0,
    }


@app.post("/uploads/resumable/init", response_model=None)
async def init_resumable_upload(request: Request):
    """
    Initialize a resumable upload session.
    Expects JSON payload:
    {
      "filename": str,
      "total_size": int,
      "allowed_user_ids": [int],
      "chunk_size": int?
    }
    """
    payload = await request.json()
    filename = payload.get("filename", "file")
    total_size = int(payload.get("total_size", 0))
    allowed_user_ids = [int(x) for x in payload.get("allowed_user_ids", [])]
    requested_chunk_size = int(payload.get("chunk_size") or 0)
    chunk_size = requested_chunk_size if requested_chunk_size > 0 else None
    return await init_resumable_upload_internal(
        filename=filename,
        total_size=total_size,
        allowed_user_ids=allowed_user_ids,
        chunk_size=chunk_size,
    )


async def get_resumable_upload_status_internal(upload_id: str, user_id: int) -> dict:
    """Internal implementation for in-process calls."""
    meta = _read_resumable_meta(upload_id)
    _assert_resumable_access(meta, user_id)
    return {
        "upload_id": upload_id,
        "filename": meta["filename"],
        "total_size": int(meta["total_size"]),
        "offset": int(meta["offset"]),
        "complete": bool(meta["complete"]),
    }


@app.get("/uploads/resumable/{upload_id}", response_model=None)
async def get_resumable_upload_status(upload_id: str, request: Request):
    user_id_header = request.headers.get("X-User-ID")
    if not user_id_header:
        raise HTTPException(status_code=401, detail="Missing user authentication")
    return await get_resumable_upload_status_internal(upload_id, int(user_id_header))


async def upload_resumable_chunk_internal(
    upload_id: str, user_id: int, offset: int, data_b64: str
) -> dict:
    """Internal implementation for in-process calls."""
    meta = _read_resumable_meta(upload_id)
    _assert_resumable_access(meta, user_id)
    if meta.get("complete"):
        raise HTTPException(status_code=409, detail="Upload already completed")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")
    if not data_b64:
        raise HTTPException(status_code=400, detail="data_b64 is required")
    expected_offset = int(meta.get("offset", 0))
    if offset != expected_offset:
        raise HTTPException(
            status_code=409,
            detail=f"Offset mismatch. expected={expected_offset} got={offset}",
        )
    chunk = base64.b64decode(data_b64)
    new_offset = expected_offset + len(chunk)
    if new_offset > int(meta["total_size"]):
        raise HTTPException(status_code=400, detail="Chunk exceeds total_size")
    data_path = _resumable_data_path(upload_id)
    with open(data_path, "ab") as f:
        f.write(chunk)
    meta["offset"] = new_offset
    meta["updated_at"] = time.time()
    _write_resumable_meta(upload_id, meta)
    return {"offset_received": new_offset}


@app.patch("/uploads/resumable/{upload_id}", response_model=None)
async def upload_resumable_chunk(upload_id: str, request: Request):
    """
    Upload one chunk for a resumable session.
    Expects JSON body:
    {
      "offset": int,
      "data_b64": str
    }
    """
    user_id_header = request.headers.get("X-User-ID")
    if not user_id_header:
        raise HTTPException(status_code=401, detail="Missing user authentication")
    payload = await request.json()
    offset = int(payload.get("offset", -1))
    data_b64 = payload.get("data_b64")
    return await upload_resumable_chunk_internal(
        upload_id, int(user_id_header), offset, data_b64
    )


async def complete_resumable_upload_internal(upload_id: str, user_id: int) -> dict:
    """Internal implementation for in-process calls."""
    meta = _read_resumable_meta(upload_id)
    _assert_resumable_access(meta, user_id)
    if int(meta.get("offset", 0)) != int(meta.get("total_size", 0)):
        raise HTTPException(
            status_code=409,
            detail=f"Upload incomplete. offset={meta.get('offset')} total={meta.get('total_size')}",
        )
    meta["complete"] = True
    meta["updated_at"] = time.time()
    _write_resumable_meta(upload_id, meta)
    return {"file_id": upload_id, "upload_id": upload_id}


@app.post("/uploads/resumable/{upload_id}/complete", response_model=None)
async def complete_resumable_upload(upload_id: str, request: Request):
    user_id_header = request.headers.get("X-User-ID")
    if not user_id_header:
        raise HTTPException(status_code=401, detail="Missing user authentication")
    return await complete_resumable_upload_internal(upload_id, int(user_id_header))


async def get_resumable_upload_data_internal(upload_id: str, user_id: int) -> dict:
    """Internal implementation for in-process calls."""
    meta = _read_resumable_meta(upload_id)
    _assert_resumable_access(meta, user_id)
    if not meta.get("complete"):
        raise HTTPException(status_code=409, detail="Upload not completed")
    data_path = _resumable_data_path(upload_id)
    if not data_path.exists():
        raise HTTPException(status_code=404, detail="Upload payload not found")
    payload = data_path.read_bytes()
    return {
        "upload_id": upload_id,
        "filename": meta["filename"],
        "file_size": len(payload),
        "encrypted_file_data_b64": base64.b64encode(payload).decode("ascii"),
    }


@app.get("/uploads/resumable/{upload_id}/data-b64", response_model=None)
async def get_resumable_upload_data(upload_id: str, request: Request):
    """
    Retrieve completed resumable upload as base64-encoded ciphertext.
    """
    user_id_header = request.headers.get("X-User-ID")
    if not user_id_header:
        raise HTTPException(status_code=401, detail="Missing user authentication")
    return await get_resumable_upload_data_internal(upload_id, int(user_id_header))


async def delete_resumable_upload_internal(upload_id: str, user_id: int) -> dict:
    """Internal implementation for in-process calls."""
    meta = _read_resumable_meta(upload_id)
    _assert_resumable_access(meta, user_id)
    try:
        _resumable_meta_path(upload_id).unlink(missing_ok=True)
        _resumable_data_path(upload_id).unlink(missing_ok=True)
    except Exception as e:
        logger.warning("STORAGE: Failed cleaning resumable session %s: %s", upload_id, e)
    return {"status": "deleted", "upload_id": upload_id}


@app.delete("/uploads/resumable/{upload_id}", response_model=None)
async def delete_resumable_upload(upload_id: str, request: Request):
    user_id_header = request.headers.get("X-User-ID")
    if not user_id_header:
        raise HTTPException(status_code=401, detail="Missing user authentication")
    return await delete_resumable_upload_internal(upload_id, int(user_id_header))


@app.get("/files/{filename}", response_model=None)
async def get_file(filename: str, request: Request):
    """
    Retrieve a stored file. Requires internal auth if configured.
    """
    # Validate filename - must be simple token created by upload
    if not filename or "/" in filename or "\\" in filename:
        logger.warning(
            "STORAGE: Invalid filename requested: %s from %s",
            filename,
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=400, detail="Invalid filename")

    path = FILES_DIR / filename
    if not path.exists() or not path.is_file():
        logger.warning(
            "STORAGE: File not found: %s from %s",
            filename,
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=404, detail="File not found")

    logger.info(
        "STORAGE: File download: %s from %s",
        filename,
        request.client.host if request.client else "unknown",
    )

    return FileResponse(str(path), media_type="application/octet-stream", filename=filename)


# File serving routes (moved from main service)
async def get_file_normal_internal(filename: str):
    """Internal: serve normal (unencrypted) files. Used by proxy when in-process."""
    safe_name = Path(filename).name
    if filename != safe_name:
        raise HTTPException(status_code=400, detail="Invalid file name")
    path = FILES_NORMAL_DIR / safe_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(path))


@app.get("/uploads/files/normal/{filename}", response_model=None)
async def get_file_normal(filename: str):
    """Serve normal (unencrypted) files."""
    return await get_file_normal_internal(filename)


async def get_file_encrypted_internal(filename: str, user_id: int):
    """Internal: serve encrypted files with permission checking. Used by proxy when in-process."""
    safe_name = Path(filename).name
    if filename != safe_name:
        raise HTTPException(status_code=400, detail="Invalid file name")
    path = FILES_DIR / safe_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not _check_file_permissions(safe_name, user_id):
        if user_id != 1:
            raise HTTPException(403, "Access denied to this file")
    return FileResponse(str(path), media_type="application/octet-stream", filename=filename)


@app.get("/uploads/files/encrypted/{filename}", response_model=None)
async def get_file_encrypted(filename: str, request: Request):
    """Serve encrypted files with permission checking."""
    user_id_header = request.headers.get("X-User-ID")
    if not user_id_header:
        raise HTTPException(status_code=401, detail="Missing user authentication")
    try:
        user_id = int(user_id_header)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid user authentication")
    return await get_file_encrypted_internal(filename, user_id)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8302"))
    uvicorn.run(app, host="0.0.0.0", port=port)