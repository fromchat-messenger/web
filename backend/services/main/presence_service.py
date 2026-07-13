"""In-memory user presence derived from WebSocket connections only."""
from __future__ import annotations

from datetime import datetime

from fastapi import WebSocket


class PresenceService:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = {}
        self._last_seen: dict[int, datetime] = {}

    def register_connection(self, user_id: int, websocket: WebSocket) -> bool:
        """Track a live connection. Returns True if the user became online."""
        connections = self._connections.setdefault(user_id, set())
        was_online = bool(connections)
        connections.add(websocket)
        return not was_online

    def unregister_connection(self, user_id: int, websocket: WebSocket) -> tuple[bool, datetime | None]:
        """Remove a connection. Returns (became_offline, last_seen) when the last conn drops."""
        connections = self._connections.get(user_id)
        if not connections:
            return False, self._last_seen.get(user_id)

        connections.discard(websocket)
        if connections:
            return False, None

        del self._connections[user_id]
        last_seen = datetime.now()
        self._last_seen[user_id] = last_seen
        return True, last_seen

    def touch(self, user_id: int) -> None:
        """Refresh activity timestamp while online."""
        if self.is_online(user_id):
            self._last_seen[user_id] = datetime.now()

    def is_online(self, user_id: int) -> bool:
        connections = self._connections.get(user_id)
        return bool(connections)

    def get_last_seen(self, user_id: int) -> datetime | None:
        if self.is_online(user_id):
            return self._last_seen.get(user_id) or datetime.now()
        return self._last_seen.get(user_id)

    def get_presence(self, user_id: int) -> tuple[bool, datetime | None]:
        online = self.is_online(user_id)
        if online:
            return True, self.get_last_seen(user_id)
        last_seen = self._last_seen.get(user_id)
        return False, last_seen

    def remove_user(self, user_id: int) -> None:
        """Drop all presence state for a deleted user."""
        self._connections.pop(user_id, None)
        self._last_seen.pop(user_id, None)


presence_service = PresenceService()
