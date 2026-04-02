"""Resolved filesystem paths for the Web repo."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProjectPaths:
    """Root and well-known directories (Web repo root = project root)."""

    project_root: Path
    scripts_dir: Path
    deployment_dir: Path
    env_file: Path
    local_cache_root: Path
    local_image_cache_dir: Path
    input_hash_script: Path

    @classmethod
    def from_deploy_package(cls) -> ProjectPaths:
        deploy_dir = Path(__file__).resolve().parent
        scripts_dir = deploy_dir.parent
        project_root = scripts_dir.parent
        deployment_dir = project_root / "deployment"
        return cls(
            project_root=project_root,
            scripts_dir=scripts_dir,
            deployment_dir=deployment_dir,
            env_file=deployment_dir / ".env",
            local_cache_root=project_root / ".deploy-cache",
            local_image_cache_dir=project_root / ".deploy-cache" / "images",
            input_hash_script=scripts_dir / "docker_inputs_hash.py",
        )
