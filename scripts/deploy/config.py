"""Load deployment/.env and CLI into settings."""

from __future__ import annotations

import os
import platform
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from deploy.paths import ProjectPaths


@dataclass
class DeploySettings:
    server: str
    repo_name: str
    deploy_path: str
    platform: str
    host_arch: str
    platform_arch: str
    use_docker_build: bool
    paths: ProjectPaths


def _machine_arch() -> str:
    m = platform.machine().lower()
    if m in ("arm64", "aarch64"):
        return "arm64"
    if m in ("x86_64", "amd64", "i386", "i686"):
        return "amd64"
    return m


def load_settings(paths: ProjectPaths, argv: list[str]) -> DeploySettings:
    if paths.env_file.is_file():
        load_dotenv(paths.env_file, override=False)

    server = (argv[1] if len(argv) > 1 else None) or os.environ.get("DEPLOYMENT_SERVER", "")
    server = server.strip()
    if not server:
        sys.stderr.write(
            "Server not specified. Usage: deploy.sh [user@host] [deployment_path] [platform]\n"
            f"   Or set DEPLOYMENT_SERVER in {paths.env_file} or as an environment variable\n\n"
            "Example:\n"
            "  deploy.sh user@example.com /home/user/fromchat linux/arm64\n"
            f"  Or add to {paths.env_file}: DEPLOYMENT_SERVER=user@example.com\n"
        )
        raise SystemExit(1)

    repo_name = "FromChat"
    deploy_path = f"~/actions-runner/_work/{repo_name}/{repo_name}"
    docker_platform = "linux/arm64"

    host_arch = _machine_arch()
    platform_arch = docker_platform.split("/", 1)[-1]
    use_docker_build = bool(host_arch and host_arch == platform_arch)

    return DeploySettings(
        server=server,
        repo_name=repo_name,
        deploy_path=deploy_path,
        platform=docker_platform,
        host_arch=host_arch,
        platform_arch=platform_arch,
        use_docker_build=use_docker_build,
        paths=paths,
    )
