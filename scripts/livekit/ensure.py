#!/usr/bin/env python3
"""
Download the LiveKit server binary for the current OS/arch from the latest GitHub release.

macOS: GitHub releases often omit darwin assets. If `livekit-server` is missing, this script
runs `brew install livekit` automatically (Homebrew must be installed).

Linux / Windows: download the matching .tar.gz / .zip from the latest release.
"""
from __future__ import annotations

import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

REPO = "livekit/livekit"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def tools_dir(root: Path) -> Path:
    return root / ".tools" / "livekit"


def platform_triple() -> tuple[str, str, str]:
    """Returns (os_name, arch, archive_ext). archive_ext is tar.gz or zip."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin":
        os_name = "darwin"
        arch = "arm64" if machine in ("arm64", "aarch64") else "amd64"
        return os_name, arch, "tar.gz"
    if system == "linux":
        os_name = "linux"
        if machine in ("aarch64", "arm64"):
            arch = "arm64"
        elif machine in ("armv7l", "armv7"):
            arch = "armv7"
        else:
            arch = "amd64"
        return os_name, arch, "tar.gz"
    if system == "windows":
        os_name = "windows"
        arch = "arm64" if machine in ("arm64", "aarch64") else "amd64"
        return os_name, arch, "zip"
    raise SystemExit(f"Unsupported OS: {system!r}")


def fetch_latest_release() -> dict:
    req = urllib.request.Request(
        API_LATEST,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "fromchat-livekit-ensure"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def pick_asset(assets: list[dict], filename: str) -> dict | None:
    for a in assets:
        if a.get("name") == filename:
            return a
    return None


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "fromchat-livekit-ensure"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        dest.write_bytes(resp.read())


def chmod_plus_x(path: Path) -> None:
    if path.suffix.lower() == ".exe" or platform.system().lower() == "windows":
        return
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def find_server_binary(extract_dir: Path) -> Path | None:
    for name in ("livekit-server", "livekit-server.exe"):
        for p in extract_dir.rglob(name):
            if p.is_file():
                return p
    return None


def resolve_macos_binary(td: Path) -> str | None:
    w = shutil.which("livekit-server")
    if w:
        return w
    # Homebrew default locations (Apple Silicon / Intel)
    for candidate in (
        Path("/opt/homebrew/bin/livekit-server"),
        Path("/usr/local/bin/livekit-server"),
    ):
        if candidate.is_file():
            return str(candidate)
    return None


def find_brew() -> str | None:
    w = shutil.which("brew")
    if w:
        return w
    for candidate in ("/opt/homebrew/bin/brew", "/usr/local/bin/brew"):
        p = Path(candidate)
        if p.is_file():
            return str(p)
    return None


def install_livekit_via_homebrew() -> bool:
    brew = find_brew()
    if not brew:
        print(
            "Homebrew not found. Install it from https://brew.sh then re-run this task.",
            file=sys.stderr,
        )
        return False
    print("Installing LiveKit via Homebrew (brew install livekit) …", file=sys.stderr)
    result = subprocess.run(
        [brew, "install", "livekit"],
        check=False,
    )
    if result.returncode != 0:
        print("brew install livekit failed.", file=sys.stderr)
        return False
    return True


def main() -> int:
    root = repo_root()
    td = tools_dir(root)
    td.mkdir(parents=True, exist_ok=True)

    os_name, arch, ext = platform_triple()

    # macOS: GitHub release assets often omit darwin; use Homebrew (auto-install if needed).
    if os_name == "darwin":
        mac_bin = resolve_macos_binary(td)
        if not mac_bin:
            if not install_livekit_via_homebrew():
                return 1
            mac_bin = resolve_macos_binary(td)
        if not mac_bin:
            print(
                "livekit-server still not found after brew install. "
                "Open a new terminal or run: hash -r",
                file=sys.stderr,
            )
            return 1
        (td / ".version").write_text("system\n", encoding="utf-8")
        print(f"Using LiveKit server: {mac_bin}", file=sys.stderr)
        print(mac_bin)
        return 0

    release = fetch_latest_release()
    tag = release.get("tag_name") or ""
    if not tag.startswith("v"):
        print("Unexpected release tag", tag, file=sys.stderr)
        return 1
    ver = tag[1:]
    assets = release.get("assets") or []

    if ext == "zip":
        archive_name = f"livekit_{ver}_{os_name}_{arch}.zip"
    else:
        archive_name = f"livekit_{ver}_{os_name}_{arch}.tar.gz"

    version_file = td / ".version"
    bin_hint = td / ("livekit-server.exe" if ext == "zip" else "livekit-server")

    if (
        version_file.is_file()
        and bin_hint.is_file()
        and version_file.read_text(encoding="utf-8").strip() == tag
    ):
        print(f"LiveKit {tag} already present at {bin_hint}", file=sys.stderr)
        print(str(bin_hint))
        return 0

    asset = pick_asset(assets, archive_name)
    if not asset:
        print(
            f"No GitHub asset {archive_name!r} for {tag}. See https://github.com/{REPO}/releases",
            file=sys.stderr,
        )
        return 1

    url = asset["browser_download_url"]
    staging = td / "_staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    archive = staging / asset["name"]
    print(f"Downloading LiveKit {tag}: {asset['name']} …", file=sys.stderr)
    download(url, archive)

    extract_dir = staging / "extract"
    extract_dir.mkdir()

    if archive_name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:gz") as tf:
            tf.extractall(extract_dir)
    elif archive_name.endswith(".zip"):
        with zipfile.ZipFile(archive, "r") as zf:
            zf.extractall(extract_dir)
    else:
        print(f"Unsupported archive: {archive_name}", file=sys.stderr)
        return 1

    binary = find_server_binary(extract_dir)
    if not binary:
        print("Could not find livekit-server binary after extract.", file=sys.stderr)
        return 1

    if bin_hint.exists():
        bin_hint.unlink()
    shutil.move(str(binary), str(bin_hint))
    chmod_plus_x(bin_hint)

    shutil.rmtree(staging)
    version_file.write_text(tag + "\n", encoding="utf-8")
    print(f"Installed LiveKit {tag} → {bin_hint}", file=sys.stderr)
    print(str(bin_hint))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
