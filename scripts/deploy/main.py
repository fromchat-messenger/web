"""CLI entry: build Docker images, pussh, rsync, restart remote systemd."""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from deploy.compose_build import (  # noqa: E402
    ComposeBuildPhase,
    classify_push_and_external,
    images_to_push_intersection,
    remote_project_name,
    verify_built_subset_push,
)
import deploy.ui as ui  # noqa: E402
from deploy.config import load_settings  # noqa: E402
import deploy.docker_local as docker_local  # noqa: E402
from deploy.paths import ProjectPaths  # noqa: E402
from deploy.ssh_auth import SshAuth  # noqa: E402
from deploy.transfer import DeployTransfer  # noqa: E402
from deploy.util import local_docker_image_tags  # noqa: E402


def main() -> None:
    paths = ProjectPaths.from_deploy_package()
    settings = load_settings(paths, sys.argv)
    ui.banner()
    creds = SshAuth(settings.server).authenticate()

    project_name = remote_project_name(settings.server, settings.deploy_path)

    ui.build_banner()
    docker_local.ensure_daemon()
    docker_local.ensure_buildx(settings.use_docker_build)

    ui.step("Detecting services")
    build_phase = ComposeBuildPhase(
        paths,
        project_name=project_name,
        platform=settings.platform,
        use_docker_build=settings.use_docker_build,
    )
    deployment_dir = paths.deployment_dir
    services = build_phase.list_services(deployment_dir)
    if not services:
        ui.error("No services found in docker-compose.yml")
        raise SystemExit(1)

    compose_json = build_phase.load_compose_json(deployment_dir)
    pushable = build_phase.collect_pushable(compose_json, services)
    to_build, _ = build_phase.plan_builds(pushable)
    built_images = build_phase.run_builds(to_build)

    ui.deploy_banner(settings.server)

    transfer = DeployTransfer(paths)
    transfer.ensure_pussh()

    push_images, external_images = classify_push_and_external(
        compose_json,
        project_name,
        local_docker_image_tags(),
        services,
    )

    verify_built_subset_push(built_images, push_images, ui)

    if not push_images and not external_images:
        ui.error(f"No images found in docker-compose.yml or built locally for project {project_name}")
        raise SystemExit(1)

    to_push = images_to_push_intersection(push_images, built_images)
    transfer.pussh_images(creds, to_push)
    transfer.pull_external_on_server(creds, external_images)

    transfer.rsync_deployment(creds, settings.deploy_path)
    transfer.copy_env_prod(creds, settings.deploy_path)
    deploy_resolved = transfer.sync_firebase_cert(creds, settings.deploy_path)
    transfer.run_remote_systemd(creds, deploy_resolved)

    print()
    ui.success("Deployment complete!")


if __name__ == "__main__":
    main()
