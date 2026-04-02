"""SSH key agent and optional sudo password for remote."""

from __future__ import annotations

import getpass
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import deploy.ui as ui


@dataclass
class SshCredentials:
    server: str
    sudo_password: str


class SshAuth:
    def __init__(self, server: str) -> None:
        self._server = server

    def authenticate(self) -> SshCredentials:
        ui.step("Authentication")
        self._ensure_agent()
        key_file = Path.home() / ".ssh" / "id_rsa"
        self._ensure_key_file(key_file)
        self._ensure_key_in_agent(key_file)
        self._verify_key_auth(key_file)
        sudo_password = self._prompt_sudo()
        return SshCredentials(server=self._server, sudo_password=sudo_password)

    def _ensure_agent(self) -> None:
        if os.environ.get("SSH_AUTH_SOCK"):
            return
        subprocess.run(["ssh-agent", "-s"], capture_output=True, check=False)

    def _ensure_key_file(self, key_file: Path) -> None:
        if not key_file.is_file():
            ui.error(f"SSH key not found at {key_file}")
            sys.stderr.write(
                "   Please generate an SSH key pair first:\n"
                "   ssh-keygen -t rsa -b 4096 -C 'your_email@example.com'\n"
            )
            raise SystemExit(1)

    def _ensure_key_in_agent(self, key_file: Path) -> None:
        loaded = False
        r = subprocess.run(["ssh-add", "-l"], capture_output=True, text=True)
        if r.returncode == 0:
            fp_r = subprocess.run(
                ["ssh-keygen", "-lf", str(key_file)],
                capture_output=True,
                text=True,
            )
            if fp_r.returncode == 0:
                parts = fp_r.stdout.strip().split()
                fingerprint = parts[1] if len(parts) > 1 else ""
                if fingerprint and fingerprint in r.stdout:
                    loaded = True
        if not loaded:
            ui.substep("Adding SSH key to agent...")
            if subprocess.run(["ssh-add", str(key_file)], capture_output=True).returncode != 0:
                ui.error("Failed to add SSH key to agent. Check your key passphrase.")
                raise SystemExit(1)

    def _verify_key_auth(self, key_file: Path) -> None:
        pub = key_file.with_suffix(key_file.suffix + ".pub")
        ok = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "StrictHostKeyChecking=no",
                self._server,
                "echo 'SSH key works'",
            ],
            capture_output=True,
        ).returncode
        if ok == 0:
            return
        ui.error(f"SSH key authentication failed for {self._server}")
        sys.stderr.write(
            f'   Copy your public key to the server, then re-run deploy:\n   ssh-copy-id -i "{pub}" "{self._server}"\n\n'
            "   Or manually append this key to ~/.ssh/authorized_keys on the server:\n"
        )
        if pub.is_file():
            sys.stderr.write(f"   {pub.read_text(encoding='utf-8', errors='replace').strip()}\n")
        raise SystemExit(1)

    def _prompt_sudo(self) -> str:
        while True:
            pw = getpass.getpass("  • Sudo password: ")
            if not pw:
                ui.warning("No password provided - assuming passwordless sudo")
                return ""
            chk = subprocess.run(
                ["ssh", self._server, "sudo", "-S", "-v"],
                input=(pw + "\n").encode(),
                capture_output=True,
            )
            if chk.returncode == 0:
                return pw
            ui.error("Invalid password, please try again")
