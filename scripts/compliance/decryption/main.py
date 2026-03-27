#!/usr/bin/env python3
"""
FromChat compliance decryption tool entrypoint.

Run:
    python scripts/compliance/decryption/main.py <command> ...
"""

from __future__ import annotations

import os
import sys


def main() -> None:
    root_dir = os.path.dirname(os.path.abspath(__file__))
    if root_dir not in sys.path:
        sys.path.insert(0, root_dir)

    from cli import main as cli_main

    cli_main()


if __name__ == "__main__":
    main()

