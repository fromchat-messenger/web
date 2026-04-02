"""Local Docker daemon, Docker Desktop, and buildx setup."""

from __future__ import annotations

import subprocess
import sys
import time

import deploy.ui as ui


BUILDER_NAME = "fromchat-builder"


def ensure_daemon() -> None:
    if _daemon_ok():
        return
    ui.warning("Docker daemon is not running")
    if not _start_desktop():
        ui.error("Failed to start Docker Desktop. Please start it manually and try again.")
        sys.exit(1)


def _daemon_ok() -> bool:
    return subprocess.run(["docker", "info"], capture_output=True).returncode == 0


def _start_desktop() -> bool:
    ui.substep("Starting Docker Desktop...")
    if subprocess.run(["docker", "desktop", "start"], capture_output=True).returncode != 0:
        return False
    ui.substep("Waiting for Docker to start...", end="")
    sys.stdout.flush()
    max_wait = 60
    waited = 0
    while waited < max_wait:
        if _daemon_ok():
            print()
            return True
        time.sleep(2)
        waited += 2
        print(".", end="", flush=True)
    print()
    return False


def ensure_buildx(use_compose_build: bool) -> None:
    if use_compose_build:
        return
    if subprocess.run(["docker", "buildx", "version"], capture_output=True).returncode != 0:
        ui.error("Docker buildx not available. Install Docker Desktop.")
        sys.exit(1)
    _setup_builder()


def _setup_builder() -> None:
    ui.step("Setting up buildx builder")
    name = BUILDER_NAME
    exists = subprocess.run(["docker", "buildx", "inspect", name], capture_output=True).returncode == 0
    if exists:
        if subprocess.run(["docker", "buildx", "use", name], capture_output=True).returncode != 0:
            ui.substep("Recreating builder...")
            subprocess.run(["docker", "buildx", "rm", name], capture_output=True)
            exists = False
        elif subprocess.run(["docker", "buildx", "inspect", name], capture_output=True).returncode != 0:
            ui.substep("Recreating builder (inspection failed)...")
            subprocess.run(["docker", "buildx", "rm", name], capture_output=True)
            exists = False
    if not exists:
        ui.substep("Creating builder with persistent cache...")
        subprocess.run(
            [
                "docker",
                "buildx",
                "create",
                "--name",
                name,
                "--driver",
                "docker-container",
                "--driver-opt",
                "image=moby/buildkit:latest",
                "--use",
                "--bootstrap",
            ],
            capture_output=True,
        )
    subprocess.run(["docker", "buildx", "use", name], capture_output=True)
