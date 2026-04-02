"""Parse docker-compose JSON and run image builds."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from deploy.paths import ProjectPaths
import deploy.ui as ui
from deploy.util import (
    compute_inputs_hash,
    dedupe_preserve,
    local_image_layer_fp,
    read_file_if_exists,
    sanitize_ref,
)


def remote_project_name(server: str, deploy_path: str) -> str:
    r = subprocess.run(
        ["ssh", server, f"dirname {deploy_path}/deployment/docker-compose.yml"],
        capture_output=True,
        text=True,
    )
    compose_dir = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else f"{deploy_path}/deployment"
    r2 = subprocess.run(["ssh", server, f"basename {compose_dir}"], capture_output=True, text=True)
    if r2.returncode == 0 and r2.stdout.strip():
        return r2.stdout.strip()
    return "deployment"


@dataclass
class PushableService:
    service: str
    image_tag: str
    dockerfile: Path
    build_context: Path
    build_target: str
    input_hash: str


class ComposeBuildPhase:
    def __init__(
        self,
        paths: ProjectPaths,
        *,
        project_name: str,
        platform: str,
        use_docker_build: bool,
    ) -> None:
        self._paths = paths
        self._project_name = project_name
        self._platform = platform
        self._use_docker_build = use_docker_build

    def load_compose_json(self, deployment_dir: Path) -> dict:
        env = os.environ.copy()
        env["COMPOSE_PROFILES"] = "production"
        p = subprocess.run(
            ["docker", "compose", "-f", "docker-compose.yml", "config", "--format", "json"],
            cwd=deployment_dir,
            capture_output=True,
            text=True,
            env=env,
        )
        if p.returncode != 0:
            ui.error("docker compose config --format json failed (needs Docker Compose v2.10+)")
            sys.exit(1)
        return json.loads(p.stdout)

    def list_services(self, deployment_dir: Path) -> list[str]:
        env = os.environ.copy()
        env["COMPOSE_PROFILES"] = "production"
        p = subprocess.run(
            ["docker", "compose", "-f", "docker-compose.yml", "config", "--services"],
            cwd=deployment_dir,
            capture_output=True,
            text=True,
            env=env,
        )
        if p.returncode != 0:
            return []
        return [s.strip() for s in p.stdout.splitlines() if s.strip()]

    def collect_pushable(self, compose: dict, services: list[str]) -> list[PushableService]:
        deployment_dir = self._paths.deployment_dir
        project_root = self._paths.project_root
        out: list[PushableService] = []
        svc_map = compose.get("services") or {}
        for service in services:
            spec = svc_map.get(service)
            if not isinstance(spec, dict):
                continue
            build = spec.get("build")
            if not isinstance(build, dict):
                continue
            image_tag = f"{self._project_name}-{service}:latest"
            dockerfile_rel = (build.get("dockerfile") or "").strip()
            context_rel = (build.get("context") or "").strip()
            build_target = (build.get("target") or "").strip()
            if not context_rel:
                context_rel = ".."
            if context_rel == "..":
                build_context = project_root
            elif context_rel.startswith("/"):
                build_context = Path(context_rel)
            else:
                build_context = deployment_dir / context_rel
            if dockerfile_rel:
                if dockerfile_rel.startswith("/"):
                    dockerfile = Path(dockerfile_rel)
                elif context_rel == ".." or build_context == project_root:
                    dockerfile = project_root / dockerfile_rel
                else:
                    dockerfile = build_context / dockerfile_rel
            else:
                cand_a = deployment_dir / f"Dockerfile.{service}"
                cand_b = deployment_dir / service / "Dockerfile"
                if cand_a.is_file():
                    dockerfile = cand_a
                elif cand_b.is_file():
                    dockerfile = cand_b
                else:
                    ui.error(f"Could not determine Dockerfile for {service}")
                    sys.exit(1)
            if not self._paths.input_hash_script.is_file():
                ui.error(f"Missing {self._paths.input_hash_script} (needed for dependency hashing)")
                sys.exit(1)
            h = compute_inputs_hash(
                build_context,
                dockerfile,
                hash_script=self._paths.input_hash_script,
            )
            if not h:
                ui.error(f"Failed to compute input hash for {service}")
                sys.exit(1)
            out.append(
                PushableService(
                    service=service,
                    image_tag=image_tag,
                    dockerfile=dockerfile,
                    build_context=build_context,
                    build_target=build_target,
                    input_hash=h,
                )
            )
        return out

    def plan_builds(self, pushable: list[PushableService]) -> tuple[list[PushableService], list[str]]:
        """Return (to_build, built_images_after) — built_images empty until build runs."""
        cache_root = self._paths.local_image_cache_dir
        cache_root.mkdir(parents=True, exist_ok=True)
        to_build: list[PushableService] = []
        for ps in pushable:
            key = sanitize_ref(ps.image_tag)
            cache_file = cache_root / key / "input.sha256"
            prev = read_file_if_exists(cache_file).strip()
            fp = local_image_layer_fp(ps.image_tag)
            if prev and prev == ps.input_hash and fp:
                continue
            to_build.append(ps)
        return to_build, []

    def run_builds(self, to_build: list[PushableService]) -> list[str]:
        if not to_build:
            ui.success("Build skipped (no Docker inputs changed)")
            return []
        ui.step(f"Building {len(to_build)} service(s)")
        deployment_dir = self._paths.deployment_dir
        env = os.environ.copy()
        env["COMPOSE_PROJECT_NAME"] = self._project_name
        env["COMPOSE_PROFILES"] = "production"
        if self._use_docker_build:
            cmd = [
                "docker",
                "compose",
                "-f",
                "docker-compose.yml",
                "--profile",
                "production",
                "build",
                *[p.service for p in to_build],
            ]
            if subprocess.run(cmd, cwd=deployment_dir, env=env).returncode != 0:
                ui.error("docker compose build failed")
                sys.exit(1)
        else:
            for ps in to_build:
                ui.substep(f"Building {ps.service} -> {ps.image_tag}...")
                args = [
                    "docker",
                    "buildx",
                    "build",
                    "--platform",
                    self._platform,
                    "--file",
                    str(ps.dockerfile),
                    "--tag",
                    ps.image_tag,
                    "--output=type=docker",
                    "--provenance=false",
                    "--sbom=false",
                ]
                if ps.build_target:
                    args.extend(["--target", ps.build_target])
                args.append(str(ps.build_context))
                if subprocess.run(args).returncode != 0:
                    ui.error(f"Build failed for {ps.service}")
                    sys.exit(1)
        built: list[str] = []
        for ps in to_build:
            key = sanitize_ref(ps.image_tag)
            d = self._paths.local_image_cache_dir / key
            d.mkdir(parents=True, exist_ok=True)
            (d / "input.sha256").write_text(ps.input_hash, encoding="utf-8")
            built.append(ps.image_tag)
        ui.success(f"Build complete! {len(built)} image(s) built")
        return built


def classify_push_and_external(
    compose: dict,
    project_name: str,
    local_tags: set[str],
    service_order: list[str],
) -> tuple[list[str], list[str]]:
    services = compose.get("services") or {}
    push_images: list[str] = []
    external: list[str] = []
    for name in service_order:
        spec = services.get(name)
        if not isinstance(spec, dict):
            continue
        image_from = (spec.get("image") or "").strip()
        build = spec.get("build")
        has_build = isinstance(build, dict)
        if image_from:
            if not has_build:
                external.append(image_from)
            else:
                push_images.append(image_from)
        else:
            tag = f"{project_name}-{name}:latest"
            if tag in local_tags:
                push_images.append(tag)
    return dedupe_preserve(push_images), dedupe_preserve(external)


def verify_built_subset_push(built: list[str], push_images: list[str], ui: object) -> None:
    matching = sum(1 for bi in built if bi in push_images)
    missing = [bi for bi in built if bi not in push_images]
    not_built = [di for di in push_images if di not in built]
    if len(built) != matching:
        ui.error(f"Mismatch between built images ({len(built)}) and detected built images ({matching}).")
        if missing:
            print(f"  Built but not detected: {' '.join(missing)}")
        if not_built:
            print(f"  Detected but not built (external images): {' '.join(not_built)}")
        print("Aborting to avoid pushing incorrect images.")
        sys.exit(1)


def images_to_push_intersection(push_images: list[str], built: list[str]) -> list[str]:
    out: list[str] = []
    for pi in push_images:
        if pi in built:
            out.append(pi)
    return dedupe_preserve(out)
