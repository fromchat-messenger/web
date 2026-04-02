"""Image pussh, rsync deployment, Firebase cert, remote systemd."""

from __future__ import annotations

import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

from deploy.paths import ProjectPaths
from deploy.ssh_auth import SshCredentials
import deploy.ui as ui

UNREGISTRY_IMAGE = "ghcr.io/psviderski/unregistry"

REMOTE_SYSTEMD_SCRIPT = r"""set -e

REMOTE_SUDO_PASS="${SUDO_PASSWORD:-}"
REMOTE_DEPLOY_PATH="${DEPLOY_PATH:-}"
export SUDO_PROMPT=""

sudo_cmd() {
    if [ -n "$REMOTE_SUDO_PASS" ]; then
        echo "$REMOTE_SUDO_PASS" | sudo -S -p '' "$@" 2>/dev/null
    else
        sudo "$@" 2>/dev/null
    fi
}

if [ -z "$REMOTE_DEPLOY_PATH" ]; then
    echo "❌ DEPLOY_PATH is not set"
    exit 1
fi

mkdir -p "$REMOTE_DEPLOY_PATH/deployment" "$REMOTE_DEPLOY_PATH/backend"
cd "$REMOTE_DEPLOY_PATH/deployment"

if [ ! -f "$REMOTE_DEPLOY_PATH/deployment/.env" ]; then
    echo "⚠️  Warning: .env file not found"
fi

if systemctl is-active --quiet fromchat; then
    sudo_cmd systemctl stop fromchat
fi

COMPOSE_PROFILES=production docker compose down --remove-orphans > /dev/null 2>&1 || true

sudo_cmd cp -f "$REMOTE_DEPLOY_PATH/deployment/fromchat.service" /etc/systemd/system/fromchat.service
sudo_cmd systemctl daemon-reload
sudo_cmd systemctl restart fromchat

sleep 3
if ! systemctl is-active --quiet fromchat; then
    echo "❌ Service failed to start"
    sudo_cmd journalctl --no-pager -xeu fromchat -n 30
    exit 1
fi
"""


class DeployTransfer:
    def __init__(self, paths: ProjectPaths) -> None:
        self._paths = paths

    def ensure_pussh(self) -> None:
        if subprocess.run(["docker", "pussh", "--help"], capture_output=True).returncode != 0:
            ui.error("docker pussh plugin not installed")
            print("   Install: npm run install:pussh")

    def ensure_unregistry(self, creds: SshCredentials) -> None:
        check = (
            "sudo docker images --format '{{.Repository}}:{{.Tag}}' | "
            f"grep -q '^{UNREGISTRY_IMAGE}$'"
        )
        if subprocess.run(["ssh", creds.server, check], capture_output=True).returncode == 0:
            return
        ui.substep("Pulling unregistry image (one-time setup)...")
        if creds.sudo_password:
            inner = f"echo {shlex.quote(creds.sudo_password)} | sudo -S -p '' docker pull {UNREGISTRY_IMAGE}"
        else:
            inner = f"sudo docker pull {UNREGISTRY_IMAGE}"
        subprocess.run(["ssh", creds.server, inner])

    def pussh_images(self, creds: SshCredentials, images: list[str]) -> None:
        ui.step("Transferring images")
        if not images:
            ui.success("Skipping image push (nothing was rebuilt this run)")
            return
        self.ensure_unregistry(creds)
        for image in images:
            ui.substep(f"Pushing {image}...")
            if subprocess.run(["docker", "pussh", image, creds.server]).returncode != 0:
                ui.error(f"Failed to push {image}")
                raise SystemExit(1)
            print()

    def pull_external_on_server(self, creds: SshCredentials, images: list[str]) -> None:
        if not images:
            return
        ui.step("Pulling external images on server")
        for image in images:
            ui.substep(f"Pulling {image}...")
            if creds.sudo_password:
                inner = f"echo {shlex.quote(creds.sudo_password)} | sudo -S -p '' docker pull {shlex.quote(image)}"
            else:
                inner = f"sudo docker pull {shlex.quote(image)}"
            if subprocess.run(["ssh", creds.server, inner]).returncode != 0:
                ui.error(f"Failed to pull {image} on server")
                raise SystemExit(1)
            print()

    def prepare_remote_dirs(self, creds: SshCredentials, deploy_path: str) -> None:
        dp = deploy_path
        d_dep = shlex.quote(f"{dp}/deployment")
        d_back = shlex.quote(f"{dp}/backend")
        if creds.sudo_password:
            pw = shlex.quote(creds.sudo_password)
            script = f"""set -e
echo {pw} | sudo -S -p '' mkdir -p {d_dep} {d_back} 2>/dev/null || true
echo {pw} | sudo -S -p '' chown -R $(whoami):$(whoami) {d_dep} {d_back} 2>/dev/null || true
"""
            subprocess.run(["ssh", creds.server, "bash"], input=script.encode(), capture_output=True)
        else:
            subprocess.run(
                [
                    "ssh",
                    creds.server,
                    f"sudo mkdir -p {d_dep} {d_back} && sudo chown -R $(whoami):$(whoami) {d_dep} {d_back}",
                ],
                capture_output=True,
            )

    def rsync_deployment(self, creds: SshCredentials, deploy_path: str) -> None:
        ui.step("Transferring deployment files")
        self.prepare_remote_dirs(creds, deploy_path)
        project_root = self._paths.project_root
        deployment_dir = self._paths.deployment_dir
        ui.substep("Copying deployment directory...")
        gl = subprocess.run(
            ["git", "ls-files", "--others", "--ignored", "--exclude-standard", "deployment/"],
            cwd=project_root,
            capture_output=True,
            text=True,
        )
        lines = [ln.replace("deployment/", "", 1) for ln in gl.stdout.splitlines() if ln.strip()]
        with tempfile.NamedTemporaryFile("w", suffix="-rsync-exclude", delete=False, encoding="utf-8") as tf:
            exclude_path = Path(tf.name)
            tf.write("\n".join(lines))
        try:
            rsync = subprocess.run(
                [
                    "rsync",
                    "-avz",
                    "--delete",
                    f"--exclude-from={exclude_path}",
                    f"{deployment_dir}/",
                    f"{creds.server}:{deploy_path}/deployment/",
                ],
                cwd=project_root,
                capture_output=True,
                text=True,
            )
            if rsync.returncode != 0:
                ui.error("Rsync failed. Error output:")
                for line in (rsync.stderr or rsync.stdout or "").splitlines():
                    print(f"    {line}")
                ui.error("Failed to copy deployment directory")
                raise SystemExit(1)
        finally:
            exclude_path.unlink(missing_ok=True)

    def copy_env_prod(self, creds: SshCredentials, deploy_path: str) -> None:
        prod = self._paths.deployment_dir / ".env.prod"
        if prod.is_file():
            ui.substep("Copying .env.prod to .env...")
            if subprocess.run(["scp", str(prod), f"{creds.server}:{deploy_path}/deployment/.env"], capture_output=True).returncode != 0:
                ui.warning("Failed to copy .env.prod to .env")
        else:
            ui.warning(".env.prod not found in deployment directory")

    def resolve_deploy_path_on_server(self, server: str, deploy_path: str) -> str:
        r = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", server, f"eval echo {deploy_path}"],
            capture_output=True,
            text=True,
        )
        out = r.stdout.strip()
        return out if out else deploy_path

    def firebase_cert_path(self) -> Path:
        return self._paths.project_root / "backend" / "firebase-cert.json"

    def cleanup_remote_firebase_dir(self, creds: SshCredentials, deploy_path_resolved: str) -> None:
        d = deploy_path_resolved
        if creds.sudo_password:
            pw = shlex.quote(creds.sudo_password)
            script = f"""set -e
D={shlex.quote(d)}
C="$D/backend/firebase-cert.json"
mkdir -p "$D/backend" 2>/dev/null || true
if [ -d "$C" ]; then
    echo {pw} | sudo -S -p '' rm -rf "$C"
fi
echo {pw} | sudo -S -p '' chown -R "$(whoami):$(whoami)" "$D/backend" 2>/dev/null || true
"""
            subprocess.run(["ssh", creds.server, "bash"], input=script.encode(), capture_output=True)
        else:
            q = shlex.quote(d)
            subprocess.run(
                [
                    "ssh",
                    creds.server,
                    f"D={q}; C=\"$D/backend/firebase-cert.json\"; mkdir -p \"$D/backend\"; "
                    f'if [ -d "$C" ]; then sudo rm -rf "$C" 2>/dev/null || rm -rf "$C"; fi; '
                    f'sudo chown -R $(whoami):$(whoami) "$D/backend" 2>/dev/null || true',
                ],
                capture_output=True,
            )

    def _wait_firebase_loop(self, cert: Path) -> None:
        while True:
            if cert.is_file():
                return
            if cert.is_dir():
                print(
                    f"  ⚠ {cert} is a directory. Delete it and save the Firebase service account JSON as a file at that exact path."
                )
            elif cert.exists():
                print(f"  ⚠ {cert} exists but is not a regular file.")
            else:
                print(f"  ⚠ Missing {cert} (Firebase service account JSON for FCM).")
            print("  Fix this, then press Enter to check again (Ctrl+C to abort deploy).")
            input()

    def sync_firebase_cert(self, creds: SshCredentials, deploy_path: str) -> str:
        ui.substep(
            "Firebase service account (runtime bind-mount: backend/firebase-cert.json)..."
        )
        resolved = self.resolve_deploy_path_on_server(creds.server, deploy_path)
        self.cleanup_remote_firebase_dir(creds, resolved)
        cert = self.firebase_cert_path()
        self._wait_firebase_loop(cert)
        remote = f"{resolved}/backend/firebase-cert.json"
        self.scp_firebase(creds, cert, remote)
        return resolved

    def scp_firebase(self, creds: SshCredentials, cert: Path, remote_path: str) -> None:
        ui.substep("Copying backend/firebase-cert.json...")
        r = subprocess.run(
            ["scp", str(cert), f"{creds.server}:{remote_path}"],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            ui.error("Failed to copy firebase-cert.json to server")
            print(f"  Target: {creds.server}:{remote_path}", file=sys.stderr)
            err = (r.stderr or r.stdout or "").strip()
            if err:
                for line in err.splitlines():
                    print(f"  {line}", file=sys.stderr)
            else:
                print("  (scp produced no output.)", file=sys.stderr)
            raise SystemExit(1)
        subprocess.run(
            ["ssh", creds.server, f"chmod 600 {shlex.quote(remote_path)}"],
            capture_output=True,
        )
        t = subprocess.run(
            ["ssh", creds.server, f"test -f {shlex.quote(remote_path)}"],
            capture_output=True,
        )
        if t.returncode != 0:
            ui.error(f"Server path is not a regular file after copy: {remote_path}")
            raise SystemExit(1)

    def run_remote_systemd(self, creds: SshCredentials, deploy_path_resolved: str) -> None:
        ui.step("Deploying on server")
        pw = creds.sudo_password
        dp = deploy_path_resolved
        remote_cmd = f"SUDO_PASSWORD={shlex.quote(pw)} DEPLOY_PATH={shlex.quote(dp)} bash -s"
        r = subprocess.run(
            ["ssh", creds.server, remote_cmd],
            input=REMOTE_SYSTEMD_SCRIPT.encode(),
            text=False,
        )
        if r.returncode != 0:
            raise SystemExit(r.returncode)
