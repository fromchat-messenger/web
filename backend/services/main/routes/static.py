"""
Static legal documents and expressive icons served from the instance deploy.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["static"])

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
_ICONS_DIR = _STATIC_DIR / "icons"


@router.get("/static/PRIVACY.md")
async def privacy_markdown() -> FileResponse:
    path = _STATIC_DIR / "PRIVACY.md"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="PRIVACY.md not found")
    return FileResponse(path, media_type="text/markdown; charset=utf-8")


@router.get("/static/TERMS.md")
async def terms_markdown() -> FileResponse:
    path = _STATIC_DIR / "TERMS.md"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="TERMS.md not found")
    return FileResponse(path, media_type="text/markdown; charset=utf-8")


@router.get("/static/icons/{name}.webp")
async def static_icon(name: str) -> FileResponse:
    safe = Path(name).name
    if safe != name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid icon name")
    path = _ICONS_DIR / f"{safe}.webp"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Icon not found")
    return FileResponse(path, media_type="image/webp")
