"""
Server-side metadata for the instance public chat (title, bio).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict

_STATIC_PROFILE_PATH = Path(__file__).resolve().parent / "static" / "public_chat_profile.json"


class PublicChatStaticProfile(TypedDict):
    id: str
    title: str
    bio: str


def load_public_chat_static_profile() -> PublicChatStaticProfile:
    if not _STATIC_PROFILE_PATH.is_file():
        raise FileNotFoundError(f"public chat profile config missing: {_STATIC_PROFILE_PATH}")
    with _STATIC_PROFILE_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    chat_id = str(data.get("id", "")).strip()
    title = str(data.get("title", "")).strip()
    bio = str(data.get("bio", "")).strip()
    if not chat_id or not title:
        raise ValueError("public chat profile config must include non-empty id and title")
    return PublicChatStaticProfile(id=chat_id, title=title, bio=bio)
