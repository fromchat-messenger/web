"""Terminal output (Rich), matching previous deploy.sh style."""

from __future__ import annotations

from rich.console import Console
from rich.text import Text

_console = Console(highlight=False)

def banner() -> None:
    _console.print()
    _console.print(Text("🚀 Deployment", style="bold magenta"))
    _console.print()


def build_banner() -> None:
    _console.print()
    _console.print(Text("🔨 Building Docker images", style="bold magenta"))
    _console.print()


def deploy_banner(server: str) -> None:
    _console.print()
    _console.print(Text(f"🚀 Deploying to {server}", style="bold magenta"))
    _console.print()


def info(msg: str) -> None:
    _console.print(Text("ℹ ", style="blue"), msg, sep="")


def success(msg: str) -> None:
    _console.print(Text("✓ ", style="green"), msg, sep="")


def warning(msg: str) -> None:
    _console.print(Text("⚠ ", style="yellow"), msg, sep="")


def error(msg: str) -> None:
    _console.print(Text("✗ ", style="red"), msg, sep="")


def step(msg: str) -> None:
    _console.print(Text("→ ", style="bold cyan"), Text(msg, style="bold"), sep="")


def substep(msg: str, *, end: str = "\n") -> None:
    _console.print(Text("  • ", style="green"), msg, sep="", end=end)
