"""Small helpers: hashing, dedupe, cache keys."""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path


def sanitize_ref(ref: str) -> str:
    s = ref.replace("/", "_").replace(":", "__").replace("@", "__at__")
    return s


def dedupe_preserve(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def read_file_if_exists(path: Path) -> str:
    if path.is_file():
        return path.read_text(encoding="utf-8", errors="replace")
    return ""


def local_image_layer_fp(image: str) -> str:
    def inspect_layers(ref: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", "image", "inspect", "-f", "{{json .RootFS.Layers}}", ref],
            capture_output=True,
            text=True,
        )

    p = inspect_layers(image)
    if p.returncode != 0:
        # Docker Desktop occasionally ends up in a state where repo:tag exists in `docker images`
        # but `docker image inspect repo:tag` fails. Inspecting by content-addressed ID works.
        id_p = subprocess.run(
            ["docker", "images", "--no-trunc", "--format", "{{.ID}}", image],
            capture_output=True,
            text=True,
        )
        image_id = (id_p.stdout or "").strip()
        if not image_id:
            return ""
        p = inspect_layers(image_id)
        if p.returncode != 0:
            return ""

    return hashlib.sha256(p.stdout.encode()).hexdigest()


def compute_inputs_hash(
    context: Path,
    dockerfile: Path,
    *,
    hash_script: Path,
    python_exe: str | None = None,
) -> str:
    exe = python_exe or sys.executable
    p = subprocess.run(
        [exe, str(hash_script), "--context", str(context), "--dockerfile", str(dockerfile)],
        capture_output=True,
        text=True,
    )
    if p.returncode != 0:
        return ""
    return p.stdout.strip()


def local_docker_image_tags() -> set[str]:
    p = subprocess.run(
        ["docker", "images", "--format", "{{.Repository}}:{{.Tag}}"],
        capture_output=True,
        text=True,
    )
    if p.returncode != 0:
        return set()
    return {line.strip() for line in p.stdout.splitlines() if line.strip()}
