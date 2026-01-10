"""
Download routes for FromChat desktop and mobile builds.
Fetches from GitHub Actions (PC) and GitHub Releases (mobile), with disk caching.
"""

import asyncio
import logging
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/download", tags=["download"])

GITHUB_API = "https://api.github.com"
WEB_OWNER, WEB_REPO = "fromchat-messenger", "web"
APP_OWNER, APP_REPO = "fromchat-messenger", "app"
WORKFLOW_FILE = "build.yml"
TIMEOUT = 10.0

ARTIFACT_NAMES = {
    "windows": "FromChat-windows",
    "linux": "FromChat-linux",
    "macos": "FromChat-macOS",
}

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "downloads"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _headers() -> dict[str, str]:
    token = os.environ.get("RELEASES_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="RELEASES_TOKEN not configured")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _etag_path(os_name: str) -> Path:
    return CACHE_DIR / f"{os_name}.etag"


def _cached_file_path(os_name: str) -> Path:
    ext = ".zip" if os_name in ARTIFACT_NAMES else (".apk" if os_name == "android" else ".ipa")
    return CACHE_DIR / f"{os_name}{ext}"


async def _fetch_pc_artifact_url(os_name: str) -> tuple[str, int]:
    """Fetch workflow runs, get latest run, find artifact. Returns (download_url, artifact_id)."""
    artifact_name = ARTIFACT_NAMES[os_name]
    logger.info("[download] Fetching PC artifact for %s: workflow=%s/%s/%s", os_name, WEB_OWNER, WEB_REPO, WORKFLOW_FILE)
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
        runs_url = f"{GITHUB_API}/repos/{WEB_OWNER}/{WEB_REPO}/actions/workflows/{WORKFLOW_FILE}/runs"
        logger.info("[download] GitHub API: GET %s (per_page=1, status=success)", runs_url)
        runs_resp = await client.get(
            runs_url,
            headers=_headers(),
            params={"per_page": 1, "status": "success"},
        )
        logger.info("[download] GitHub workflow runs response: status=%s", runs_resp.status_code)
        runs_resp.raise_for_status()
        runs = runs_resp.json()
        workflow_runs = runs.get("workflow_runs", [])
        if not workflow_runs:
            logger.warning("[download] No successful workflow runs for %s", artifact_name)
            raise HTTPException(status_code=404, detail=f"No successful workflow run for {artifact_name}")

        run_id = workflow_runs[0]["id"]
        logger.info("[download] Latest run_id=%s, fetching artifacts", run_id)
        artifacts_url = f"{GITHUB_API}/repos/{WEB_OWNER}/{WEB_REPO}/actions/runs/{run_id}/artifacts"
        artifacts_resp = await client.get(artifacts_url, headers=_headers())
        logger.info("[download] GitHub artifacts response: status=%s", artifacts_resp.status_code)
        artifacts_resp.raise_for_status()
        data = artifacts_resp.json()
        for artifact in data.get("artifacts", []):
            if artifact["name"] == artifact_name:
                url = artifact["archive_download_url"]
                aid = artifact["id"]
                logger.info("[download] Found artifact %s id=%s, download_url=%s", artifact_name, aid, url[:80] + "..." if len(url) > 80 else url)
                return url, aid
        logger.warning("[download] Artifact %s not found in run %s", artifact_name, run_id)
        raise HTTPException(status_code=404, detail=f"Artifact {artifact_name} not found")


async def _fetch_mobile_asset_url(os_name: str) -> str:
    """Fetch latest release, find asset by name. Returns browser_download_url."""
    keyword = "android" if os_name == "android" else "ios"
    logger.info("[download] Fetching mobile asset for %s: releases %s/%s", os_name, APP_OWNER, APP_REPO)
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
        releases_url = f"{GITHUB_API}/repos/{APP_OWNER}/{APP_REPO}/releases"
        logger.info("[download] GitHub API: GET %s (per_page=10)", releases_url)
        resp = await client.get(
            releases_url,
            headers=_headers(),
            params={"per_page": 10},
        )
        logger.info("[download] GitHub releases response: status=%s", resp.status_code)
        resp.raise_for_status()
        releases = resp.json()
        for release in releases:
            if release.get("draft"):
                continue
            for asset in release.get("assets", []):
                if keyword.lower() in asset.get("name", "").lower():
                    url = asset["browser_download_url"]
                    logger.info("[download] Found %s asset: %s (release: %s)", os_name, asset.get("name"), release.get("tag_name"))
                    return url
        logger.warning("[download] No %s asset in releases", os_name)
        raise HTTPException(status_code=404, detail=f"No {os_name} asset found in releases")


async def _download_and_stream(
    url: str,
    os_name: str,
    stored_etag: str | None,
) -> StreamingResponse | FileResponse:
    """Stream from GitHub to client and save to disk. If 304, serve from disk."""
    etag_path = _etag_path(os_name)
    cache_path = _cached_file_path(os_name)
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    headers = {**_headers(), "Accept": "*/*"}
    if stored_etag:
        headers["If-None-Match"] = stored_etag

    logger.info("[download] Mobile %s: GET %s (etag=%s)", os_name, url[:100] + "..." if len(url) > 100 else url, stored_etag or "none")

    async def stream_and_save():
        total = 0
        tmp_path = cache_path.with_name(cache_path.name + ".tmp")
        new_etag: str | None = None
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                async with client.stream("GET", url, headers=headers) as resp:
                    if resp.status_code == 304 and cache_path.exists():
                        yield None
                        return
                    if resp.status_code != 200:
                        if resp.status_code in (404, 410):
                            raise HTTPException(
                                status_code=404,
                                detail="Release asset not found on GitHub",
                            )
                        raise HTTPException(
                            status_code=503,
                            detail="GitHub returned an error while downloading asset",
                        )
                    new_etag = resp.headers.get("etag")
                    logger.info("[download] Mobile %s: streaming (content-length=%s)", os_name, resp.headers.get("content-length") or "unknown")
                    with open(tmp_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            f.write(chunk)
                            total += len(chunk)
                            yield chunk
            tmp_path.rename(cache_path)
            if new_etag:
                etag_path.write_text(new_etag)
            logger.info("[download] Mobile %s: completed, saved %d bytes", os_name, total)
        except httpx.StreamClosed:
            logger.info("[download] Mobile %s: client disconnected after %d bytes", os_name, total)
            tmp_path.unlink(missing_ok=True)
        except httpx.TimeoutException:
            tmp_path.unlink(missing_ok=True)
            if cache_path.exists():
                raise _CacheFallback()
            raise HTTPException(status_code=503, detail="GitHub unavailable and no cached file")
        except HTTPException:
            tmp_path.unlink(missing_ok=True)
            raise

    class _CacheFallback(Exception):
        pass

    gen = stream_and_save()
    try:
        first = await gen.__anext__()
    except StopAsyncIteration:
        first = None
    except _CacheFallback:
        await gen.aclose()
        return FileResponse(str(cache_path), media_type="application/octet-stream", filename=cache_path.name)
    if first is None:
        await gen.aclose()
        logger.info("[download] Mobile %s: serving from cache (304)", os_name)
        return FileResponse(str(cache_path), media_type="application/octet-stream", filename=cache_path.name)

    async def body():
        yield first
        async for chunk in gen:
            yield chunk

    return StreamingResponse(
        body(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{cache_path.name}"'},
    )


async def _resolve_artifact_download_url(url: str) -> str:
    """Resolve artifact URL: GitHub 302 redirects to Azure; Azure rejects Authorization. Get Location without following."""
    headers = {**_headers(), "Accept": "application/vnd.github+json"}
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code in (404, 410):
            raise HTTPException(status_code=404, detail="Artifact not found on GitHub")
        if resp.status_code != 302:
            raise HTTPException(status_code=503, detail="GitHub returned an error while resolving artifact URL")
        location = resp.headers.get("location")
        if not location:
            raise HTTPException(status_code=502, detail="No redirect location from GitHub")
        return location


async def _download_artifact_and_stream(
    url: str,
    os_name: str,
    artifact_id: int,
) -> StreamingResponse | FileResponse:
    """Download artifact (zip). GitHub redirects to Azure; Azure must be called WITHOUT Authorization."""
    etag_path = _etag_path(os_name)
    cache_path = _cached_file_path(os_name)
    stored_id = etag_path.read_text().strip() if etag_path.exists() else None
    if stored_id == str(artifact_id) and cache_path.exists():
        logger.info("[download] PC %s: serving from cache (artifact_id=%s)", os_name, artifact_id)
        return FileResponse(
            str(cache_path),
            media_type="application/zip",
            filename=cache_path.name,
        )

    try:
        download_url = await _resolve_artifact_download_url(url)
    except HTTPException:
        if cache_path.exists():
            logger.info("[download] PC %s: GitHub error, serving from cache", os_name)
            return FileResponse(str(cache_path), media_type="application/zip", filename=cache_path.name)
        raise

    logger.info("[download] PC %s: streaming from Azure URL (no auth)", os_name)

    async def stream_and_save():
        total = 0
        tmp_path = cache_path.with_name(cache_path.name + ".tmp")
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                async with client.stream("GET", download_url) as resp:
                    if resp.status_code != 200:
                        if resp.status_code in (404, 410):
                            raise HTTPException(status_code=404, detail="Artifact file not found on GitHub")
                        raise HTTPException(
                            status_code=503,
                            detail="GitHub returned an error while downloading artifact file",
                        )
                    logger.info("[download] PC %s: streaming (content-length=%s)", os_name, resp.headers.get("content-length") or "unknown")
                    with open(tmp_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=65536):
                            f.write(chunk)
                            total += len(chunk)
                            yield chunk
            tmp_path.rename(cache_path)
            etag_path.write_text(str(artifact_id))
            logger.info("[download] PC %s: completed, saved %d bytes", os_name, total)
        except httpx.StreamClosed:
            logger.info("[download] PC %s: client disconnected after %d bytes", os_name, total)
            tmp_path.unlink(missing_ok=True)
        except HTTPException:
            tmp_path.unlink(missing_ok=True)
            raise

    gen = stream_and_save()
    try:
        first = await gen.__anext__()
    except StopAsyncIteration:
        first = None
    except HTTPException:
        if cache_path.exists():
            return FileResponse(str(cache_path), media_type="application/zip", filename=cache_path.name)
        raise

    if first is None:
        await gen.aclose()
        raise HTTPException(status_code=502, detail="Empty response from download")

    async def body():
        yield first
        async for chunk in gen:
            yield chunk

    return StreamingResponse(
        body(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{cache_path.name}"'},
    )


def _head_response(filename: str, content_length: int | None = None) -> Response:
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if content_length is not None:
        headers["Content-Length"] = str(content_length)
    return Response(status_code=200, headers=headers)


@router.api_route("/{os_name}", methods=["GET", "HEAD"])
async def download(request: Request, os_name: str):
    """Download app for the given OS: windows, linux, macos, android, ios."""
    is_head = request.method == "HEAD"
    os_name = os_name.lower()
    logger.info("[download] %s /download/%s", request.method, os_name)

    if os_name not in ("windows", "linux", "macos", "android", "ios"):
        raise HTTPException(status_code=400, detail="Invalid os. Use: windows, linux, macos, android, ios")

    try:
        if os_name in ARTIFACT_NAMES:
            try:
                url, artifact_id = await asyncio.wait_for(
                    _fetch_pc_artifact_url(os_name),
                    timeout=TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning("[download] PC %s: GitHub API timeout", os_name)
                cache_path = _cached_file_path(os_name)
                if cache_path.exists():
                    if is_head:
                        return _head_response(cache_path.name, cache_path.stat().st_size)
                    return FileResponse(
                        str(cache_path),
                        media_type="application/zip",
                        filename=cache_path.name,
                    )
                raise HTTPException(status_code=503, detail="GitHub unavailable and no cached file")
            cache_path = _cached_file_path(os_name)
            result = await _download_artifact_and_stream(url, os_name, artifact_id)
            if is_head:
                fn = getattr(result, "filename", None) or cache_path.name
                size = cache_path.stat().st_size if cache_path.exists() else None
                return _head_response(fn, size)
            return result
        else:
            stored_etag = None
            etag_path = _etag_path(os_name)
            cache_path = _cached_file_path(os_name)
            if etag_path.exists():
                stored_etag = etag_path.read_text().strip() or None

            try:
                url = await asyncio.wait_for(
                    _fetch_mobile_asset_url(os_name),
                    timeout=TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning("[download] Mobile %s: GitHub API timeout", os_name)
                if cache_path.exists():
                    if is_head:
                        return _head_response(cache_path.name, cache_path.stat().st_size)
                    return FileResponse(
                        str(cache_path),
                        media_type="application/octet-stream",
                        filename=cache_path.name,
                    )
                raise HTTPException(status_code=503, detail="GitHub unavailable and no cached file")

            result = await _download_and_stream(url, os_name, stored_etag)
            if is_head:
                fn = getattr(result, "filename", None) or cache_path.name
                size = cache_path.stat().st_size if cache_path.exists() else None
                return _head_response(fn, size)
            return result
    except HTTPException as exc:
        if exc.status_code in (404, 410):
            raise HTTPException(status_code=404, detail=exc.detail)
        if exc.status_code in (502, 503, 504):
            raise HTTPException(status_code=503, detail=exc.detail)
        raise
