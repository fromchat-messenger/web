from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from getpass import getpass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from bundle_decrypt import decrypt_bundle
from bundle_extract import extract_bundle
from crypto import derive_auth_secret
from http_client import http_get_json, http_post_json


class _Ansi:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    CYAN = "\033[36m"
    MAGENTA = "\033[35m"


INDENT = 0


def indent() -> None:
    global INDENT
    INDENT += 2


def unindent() -> None:
    global INDENT
    INDENT = max(0, INDENT - 2)


def _pad() -> str:
    return " " * INDENT


def _color(text: str, color: str) -> str:
    return f"{color}{text}{_Ansi.RESET}"


def success(msg: str) -> None:
    print(f"{_pad()}{_Ansi.GREEN}✓{_Ansi.RESET} {msg}")


def warning(msg: str) -> None:
    print(f"{_pad()}{_Ansi.YELLOW}⚠{_Ansi.RESET} {msg}")


def error(msg: str) -> None:
    print(f"{_pad()}{_Ansi.RED}✗{_Ansi.RESET} {msg}")


def step(msg: str) -> None:
    print(f"{_pad()}{_Ansi.CYAN}{_Ansi.BOLD}→{_Ansi.RESET} {_Ansi.BOLD}{msg}{_Ansi.RESET}")
    indent()


def substep(msg: str) -> None:
    print(f"{_pad()}{_Ansi.GREEN}•{_Ansi.RESET} {msg}")


def _prompt(text: str, *, default: Optional[str] = None, secret: bool = False, icon: str = "bullet") -> str:
    suffix = f" [{default}]" if default is not None and default != "" else ""

    if icon == "warning":
        icon_str = f"{_Ansi.YELLOW}⚠{_Ansi.RESET}"
    else:  # default "bullet"
        icon_str = f"{_Ansi.GREEN}•{_Ansi.RESET}"

    q = f"{_pad()}{icon_str} {text}{suffix}: "
    while True:
        v = (getpass(q) if secret else input(q)).strip()
        if v:
            return v
        if default is not None:
            return default
        warning("Value is required.")


def _prompt_choice(*, default: str) -> str:
    """
    Choice prompt in the style:

        \\n{indent}{dot} Your choice: (default X)
    """
    q = f"\n{_pad()}{_Ansi.GREEN}•{_Ansi.RESET} Your choice: (default {default}): "
    v = input(q).strip()
    return v or default


def _choose_option(options: Sequence[str], *, default: str) -> str:
    substep("Choose an option:")
    indent()
    try:
        for opt in options:
            substep(opt)
        return _prompt_choice(default=default)
    finally:
        unindent()


def _prompt_bool(text: str, *, default: bool = True) -> bool:
    suffix = " [Y/n]" if default else " [y/N]"
    q = f"{_pad()}{_Ansi.GREEN}•{_Ansi.RESET} {text}{suffix}: "
    while True:
        v = input(q).strip().lower()
        if not v:
            return default
        if v in {"y", "yes"}:
            return True
        if v in {"n", "no"}:
            return False
        warning("Please answer y/n.")


def _prompt_bool_required(text: str) -> bool:
    """
    Ask a y/n question with no default (user must enter y or n).
    """
    suffix = " [y/n]"
    q = f"{_pad()}{_Ansi.GREEN}•{_Ansi.RESET} {text}{suffix}: "
    while True:
        v = input(q).strip().lower()
        if v in {"y", "yes"}:
            return True
        if v in {"n", "no"}:
            return False
        warning("Please answer y/n.")


def _parse_message_ids(raw: str) -> List[int]:
    tokens = [t.strip() for t in raw.replace(",", " ").split() if t.strip()]
    out: list[int] = []
    for t in tokens:
        if "-" in t:
            a, b = t.split("-", 1)
            start = int(a.strip())
            end = int(b.strip())
            if start <= end:
                out.extend(list(range(start, end + 1)))
            else:
                out.extend(list(range(start, end - 1, -1)))
        else:
            out.append(int(t))
    seen: set[int] = set()
    uniq: list[int] = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def _build_api_base(server: str, *, https: bool) -> str:
    s = (server or "").strip()
    if s.startswith("http://"):
        s = s[len("http://") :]
    if s.startswith("https://"):
        s = s[len("https://") :]
    scheme = "https" if https else "http"
    return f"{scheme}://{s}/api"


@dataclass(frozen=True)
class _AuthResult:
    api_base_url: str
    token: str
    did_login: bool


def _login(api_base_url: str, username: str, password: str) -> str:
    derived = derive_auth_secret(username, password)
    resp = http_post_json(f"{api_base_url.rstrip('/')}/login", {"username": username, "password": derived})
    token = resp.get("token") if isinstance(resp, dict) else None
    if not isinstance(token, str) or not token:
        raise RuntimeError("Login did not return a token")
    return token


def _logout(api_base_url: str, token: str) -> None:
    try:
        http_get_json(f"{api_base_url.rstrip('/')}/logout", token)
    except Exception:
        # Must best-effort logout; don't mask original errors.
        pass


def _ensure_online_auth(
    *,
    server: Optional[str],
    https: Optional[bool],
    jwt: Optional[str],
    username: Optional[str],
    password: Optional[str],
) -> _AuthResult:
    if not server:
        server = _prompt("Server (host:port)", default="localhost:8301")
    use_https = bool(https) if https is not None else _prompt_bool("Use HTTPS", default=True)
    api_base_url = _build_api_base(server, https=use_https)

    if jwt and (username or password):
        raise SystemExit("Provide either --jwt OR --username/--password, not both.")

    if jwt:
        return _AuthResult(api_base_url=api_base_url, token=jwt.strip(), did_login=False)

    step("Authentication")
    try:
        if not username and password is None:
            method = _choose_option(["1) Login + password", "2) JWT token"], default="1")
            if method.strip() == "2":
                jwt_in = _prompt("JWT token")
                return _AuthResult(api_base_url=api_base_url, token=jwt_in.strip(), did_login=False)

        if not username:
            username = _prompt("Username")
        if password is None:
            password = _prompt("Password", secret=True)

        token = _login(api_base_url, username, password)
        return _AuthResult(api_base_url=api_base_url, token=token, did_login=True)
    finally:
        unindent()


def cmd_extract(args: argparse.Namespace) -> None:
    if getattr(args, "https", False) and getattr(args, "http", False):
        raise SystemExit("Choose only one: --https or --http")

    server = args.server
    if not server:
        server = _prompt("Server (host:port)", default="fromchat.ru")

    if args.https or args.http:
        https_choice: Optional[bool] = True if args.https else False
    else:
        https_choice = _prompt_bool_required("Use HTTPS")

    jwt: Optional[str] = args.jwt
    username: Optional[str] = args.username
    password: Optional[str] = args.password

    message_ids: List[int] = []
    if getattr(args, "message_ids", None):
        message_ids.extend(list(args.message_ids))
    if not message_ids:
        message_ids = []

    out_dir = args.out_dir

    last_err: Optional[BaseException] = None
    for attempt in range(1, 6):
        try:
            auth = _ensure_online_auth(
                server=server,
                https=https_choice,
                jwt=jwt,
                username=username,
                password=password,
            )
        except Exception as e:
            last_err = e
            msg = str(e)
            warning(msg)
            if "HTTP 401" in msg or "HTTP 403" in msg:
                warning("Auth failed. Please enter username and password again.")
                jwt = None
                username = _prompt("Username")
                password = _prompt("Password", secret=True)
                continue

            jwt = None
            username = None
            password = None
            if not _prompt_bool("Try again", default=True):
                raise SystemExit(1)
            continue

        if not message_ids:
            raw = _prompt("Message IDs (space/comma, ranges like 1-5 supported)")
            message_ids = _parse_message_ids(raw)

        if not out_dir:
            out_dir = _prompt("Output directory", default="./tmp/compliance_bundle")

        step(f"Extracting {len(message_ids)} message(s)")
        try:
            manifest_path = extract_bundle(auth.api_base_url, auth.token, message_ids, out_dir)
            success(f"Bundle created: {out_dir}")
            success(f"Manifest: {manifest_path}")
            return
        except Exception as e:
            last_err = e
            msg = str(e)
            if "HTTP 401" in msg or "HTTP 403" in msg:
                warning(msg)
                warning("Auth failed. Please enter username and password again.")
                jwt = None
                username = _prompt("Username")
                password = _prompt("Password", secret=True)
                continue
            else:
                raise
        finally:
            unindent()
            if auth.did_login:
                _logout(auth.api_base_url, auth.token)

    if last_err:
        raise SystemExit(str(last_err))
    raise SystemExit(1)


def cmd_decrypt_bundle(args: argparse.Namespace) -> None:
    bundle_dir = args.bundle_dir or _prompt("Bundle directory (contains bundle.json)", default="./tmp/compliance_bundle")
    output_dir = args.output_dir or _prompt("Output directory", default="./tmp/compliance_bundle_decrypted")

    # Try to load the compliance key, prompt for path if not found
    key_file = "compliance_keypair.txt"
    private_key_b64 = None

    try:
        from crypto import load_compliance_private_key
        load_compliance_private_key(key_file=key_file)
    except FileNotFoundError:
        warning(f"Compliance key file not found: {key_file}")
        key_file = _prompt("Path to compliance_keypair.txt")
    except Exception as e:
        # If file exists but key can't be loaded, ask user to paste it
        private_key_b64 = _prompt("Couldn't find the private key. Please enter the X25519 PRIVATE key (base64, 43 chars)", secret=False, icon="warning")
        if not private_key_b64 or not private_key_b64.strip():
            raise RuntimeError("No private key provided")

        # Create a temporary key file
        import tempfile
        import os
        temp_fd, temp_path = tempfile.mkstemp(suffix='.txt', prefix='compliance_key_')
        try:
            with os.fdopen(temp_fd, 'w') as f:
                f.write(f"PRIVATE_KEY={private_key_b64.strip()}\n")
                f.write("PUBLIC_KEY=dummy\n")  # Not needed for decryption
            key_file = temp_path
        except Exception:
            os.close(temp_fd)
            raise

    step("Decrypting bundle")
    try:
        index_path = decrypt_bundle(bundle_dir, output_dir, key_file=key_file)
        success(f"Bundle decrypted into: {output_dir}")
        success(f"Report: {index_path}")
    except Exception as e:
        # Provide user-friendly error messages for common issues
        if "InvalidTag" in str(type(e)) or "InvalidTag" in str(e):
            error("Failed to decrypt bundle: Key mismatch - the bundle was encrypted with a different compliance key")
        else:
            error(f"Failed to decrypt bundle: {repr(e) if e else type(e).__name__}")
        # Don't re-raise since we've already displayed the error
    finally:
        unindent()
    


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compliance Message Decryption Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    extract_parser = subparsers.add_parser("extract", help="Extract messages + encrypted files from API (online)")
    extract_parser.add_argument("--server", required=False, help="Server host:port (e.g. localhost:8301)")
    extract_parser.add_argument("--https", action="store_true", help="Use HTTPS (default in interactive mode)")
    extract_parser.add_argument("--http", action="store_true", help="Use HTTP")
    extract_parser.add_argument("--jwt", required=False, help="JWT token (Bearer)")
    extract_parser.add_argument("--username", required=False, help="Login username (alternative to --jwt)")
    extract_parser.add_argument("--password", required=False, help="Login password (will be prompted if omitted)")
    extract_parser.add_argument("--message-ids", required=False, type=int, nargs="+", help="Message IDs to extract")
    extract_parser.add_argument("--out-dir", required=False, help="Directory to write the extracted bundle")
    extract_parser.set_defaults(func=cmd_extract)

    decrypt_bundle_parser = subparsers.add_parser("decrypt", help="Decrypt a bundle created by extract (offline)")
    decrypt_bundle_parser.add_argument("--bundle-dir", required=False, help="Path to extracted bundle directory (contains bundle.json)")
    decrypt_bundle_parser.add_argument("--output-dir", required=False, help="Directory to write decrypted output (HTML + files)")
    decrypt_bundle_parser.set_defaults(func=cmd_decrypt_bundle)


    return parser


def _run_full_interactive() -> None:
    print(f"{_Ansi.MAGENTA}{_Ansi.BOLD}FromChat compliance tool{_Ansi.RESET}\n")

    step("Choose an action")
    try:
        choice = _choose_option(
            [
                "1) Extract bundle from server",
                "2) Decrypt bundle (offline)",
                "0) Exit",
            ],
            default="1",
        )
    finally:
        unindent()
    if choice == "0":
        raise SystemExit(0)

    try:
        if choice == "1":
            step("Extract bundle from server")
            try:
                args = argparse.Namespace(
                    server=None,
                    https=False,
                    http=False,
                    jwt=None,
                    username=None,
                    password=None,
                    message_ids=None,
                    out_dir=None,
                )
                cmd_extract(args)
            finally:
                unindent()
        elif choice == "2":
            step("Decrypt bundle (offline)")
            try:
                args = argparse.Namespace(bundle_dir=None, output_dir=None)
                cmd_decrypt_bundle(args)
            finally:
                unindent()
        else:
            warning("Unknown choice.")
    except SystemExit:
        raise
    except Exception as e:
        error(str(e))


def main(argv: List[str] | None = None) -> None:
    try:
        parser = build_parser()
        if argv is None and len(sys.argv) <= 1:
            _run_full_interactive()
            return

        args = parser.parse_args(argv)
        if not getattr(args, "command", None):
            _run_full_interactive()
            return


        try:
            args.func(args)
        except SystemExit:
            raise
        except Exception as e:
            error(str(e))
            raise SystemExit(1)
    except KeyboardInterrupt:
        pass
