from __future__ import annotations

import logging
from html import unescape
from typing import Any, Callable, Dict, List

from ..logging_config import access_logger, dm_logger, public_chat_logger, security_logger


def _clean_username(username: Any) -> str:
    if not username:
        return "unknown user"
    return f"@{username}"


def _format_user(fields: Dict[str, Any], username_key: str = "username", user_id_key: str = "user_id") -> str:
    username = fields.get(username_key)
    if username is None and "_" in username_key:
        base_key = username_key.split("_", 1)[0]
        username = fields.get(base_key)

    user_id = fields.get(user_id_key)
    if user_id is None and "_" in user_id_key:
        base_key = user_id_key.split("_", 1)[0]
        user_id = fields.get(base_key)

    if username and user_id is not None:
        return f"{_clean_username(username)} (user id {user_id})"
    if username:
        return _clean_username(username)
    if user_id is not None:
        return f"user id {user_id}"
    return "unknown user"


def _format_actor(fields: Dict[str, Any], prefix: str) -> str:
    return _format_user(fields, f"{prefix}_username", f"{prefix}_id")


def _plural(label: str, count: int) -> str:
    return f"{count} {label if count == 1 else label + 's'}"


def _yes_no(flag: Any) -> str:
    return "yes" if flag else "no"


def _render_security(action: str, fields: Dict[str, Any]) -> List[str]:
    if action == "login_success":
        lines = [f"Login approved for {_format_user(fields)}"]
        session = fields.get("session_id")
        if session:
            lines.append(f"Session: {session}")
        client_bits: List[str] = []
        if fields.get("device"):
            client_bits.append(fields["device"])
        if fields.get("os"):
            client_bits.append(fields["os"])
        if fields.get("browser"):
            client_bits.append(fields["browser"])
        if client_bits:
            lines.append(f"Client: {', '.join(client_bits)}")
        if fields.get("ip"):
            lines.append(f"IP address: {fields['ip']}")
        return lines
    if action == "login_failed":
        lines = [f"Login denied for {_format_user(fields)}"]
        if fields.get("reason"):
            lines.append(f"Reason: {fields['reason']}")
        if fields.get("ip"):
            lines.append(f"IP address: {fields['ip']}")
        return lines
    if action == "auth_bruteforce_detected":
        lines = ["Brute-force login pattern detected"]
        lines.append(f"Target: {_format_user(fields)}")
        failures = fields.get("failures")
        if isinstance(failures, dict):
            for key, value in failures.items():
                lines.append(f"{key}: {value}")
        if fields.get("ip"):
            lines.append(f"IP address: {fields['ip']}")
        if fields.get("window_seconds"):
            lines.append(f"Observation window: {fields['window_seconds']} seconds")
        return lines
    if action == "registration_success":
        ip_raw = fields.get("ip")
        ip_display = "localhost" if ip_raw in {"127.0.0.1", "::1"} else ip_raw
        display_name = fields.get("display_name") or "Unknown"
        username = fields.get("username")
        user_id = fields.get("user_id")
        user_agent = fields.get("user_agent") or "Unknown user agent"
        lines = ["Account registered"]
        lines.append(f"Display name: {display_name}")
        lines.append(f"Username: {_clean_username(username) if username else 'unknown'}")
        if ip_display:
            lines.append(f"IP: {ip_display}")
        if user_agent:
            lines.append(f"User agent: {user_agent}")
        if user_id is not None:
            lines.append(f"User ID: {user_id}")
        return lines
    if action == "password_changed":
        lines = [f"Password changed for {_format_user(fields)}"]
        lines.append(f"Other sessions revoked: {_yes_no(fields.get('logout_others'))}")
        if fields.get("ip"):
            lines.append(f"IP address: {fields['ip']}")
        return lines
    if action == "logout":
        lines = [f"Logout recorded for {_format_user(fields)}"]
        if fields.get("session_id"):
            lines.append(f"Session: {fields['session_id']}")
        if fields.get("ip"):
            lines.append(f"IP address: {fields['ip']}")
        return lines
    if action == "admin_delete_user":
        return [
            "Account removal",
            f"Actor: {_format_actor(fields, 'actor')}",
            f"Target: {_format_actor(fields, 'target')}",
        ]
    if action == "admin_suspend_user":
        lines = [
            "User suspension",
            f"Actor: {_format_actor(fields, 'actor')}",
            f"Target: {_format_actor(fields, 'target')}",
        ]
        if fields.get("reason"):
            lines.append(f"Reason: {fields.get('reason')}")
        return lines
    if action == "admin_unsuspend_user":
        return [
            "User unsuspension",
            f"Actor: {_format_actor(fields, 'actor')}",
            f"Target: {_format_actor(fields, 'target')}",
        ]
    if action == "admin_verify_toggle":
        return [
            "User verification",
            f"Actor: {_format_actor(fields, 'actor')}",
            f"Target: {_format_actor(fields, 'target')}",
            f"Verified: {_yes_no(fields.get('verified'))}",
        ]
    if action == "self_delete_account":
        return [f"User {_format_user(fields)} deleted their account"]
    if action == "auto_suspension_public_spam":
        lines = [
            f"Automatic suspension triggered for {_format_user(fields)}",
        ]
        match_type = fields.get("match_type")
        if match_type:
            lines.append(f"Match type: {match_type}")
        similar = fields.get("similar_messages")
        occurrences = fields.get("occurrences")
        if similar:
            lines.append(f"Similar messages detected: {similar}")
        if occurrences and not similar:
            lines.append(f"Occurrences: {occurrences}")
        if fields.get("window_seconds"):
            lines.append(f"Observation window: {fields['window_seconds']} seconds")
        if fields.get("reason"):
            lines.append(f"Reason: {fields['reason']}")
        return lines
    if action == "auto_suspension_public_burst":
        lines = [
            f"Automatic suspension triggered for {_format_user(fields)}",
            f"Messages sent: {fields.get('count')} within {fields.get('window_seconds')} seconds",
        ]
        if fields.get("reason"):
            lines.append(f"Reason: {fields['reason']}")
        return lines
    if action == "public_message_burst":
        return [
            f"Rapid messaging spike for {_format_user(fields)}",
            f"Messages sent: {fields.get('count')} within {fields.get('window_seconds')} seconds",
        ]
    if action == "blocklist_add":
        added = fields.get("added") or []
        lines = [f"Blocklist updated by {_format_actor(fields, 'actor')}"]
        if added:
            lines.append(f"Added entries: {', '.join(added)}")
        total = len(fields.get("words") or [])
        lines.append(f"Total entries: {total}")
        return lines
    if action == "blocklist_remove":
        removed = fields.get("removed") or []
        lines = [f"Blocklist cleaned by {_format_actor(fields, 'actor')}"]
        if removed:
            lines.append(f"Removed entries: {', '.join(removed)}")
        total = len(fields.get("words") or [])
        lines.append(f"Total entries: {total}")
        return lines
    return [f"{action.replace('_', ' ').capitalize()}"] + [
        f"{key.replace('_', ' ').capitalize()}: {value}"
        for key, value in fields.items()
        if value is not None
    ]


def _render_public_chat(action: str, fields: Dict[str, Any]) -> List[str]:
    if action == "message_created":
        lines = [f"Message #{fields.get('message_id')} sent by {_format_user(fields)}"]
        if fields.get("reply_to"):
            lines.append(f"In reply to message #{fields['reply_to']}")
        attachments = fields.get("attachments")
        if attachments:
            lines.append(f"Attachments: {_plural('file', attachments)}")
        
        # If content was censored, log both raw and censored versions
        if fields.get("raw_content") is not None:
            lines.append("Raw content (before censoring):")
            for line in unescape(fields["raw_content"]).splitlines():
                lines.append(f"| {line}")
            lines.append("Censored content (stored):")
            for line in unescape(fields.get("censored_content", fields.get("content", ""))).splitlines():
                lines.append(f"| {line}")
        elif fields.get("content"):
            lines.append("Content:")
            for line in unescape(fields["content"]).splitlines():
                lines.append(f"| {line}")
        return lines
    if action == "message_edited":
        lines = [f"Message #{fields.get('message_id')} edited by {_format_user(fields)}"]
        if fields.get("reply_to"):
            lines.append(f"Reply to #{fields['reply_to']}")
        if fields.get("previous_content"):
            lines.append("Previous content:")
            for line in unescape(fields["previous_content"] or "").splitlines() or [""]:
                lines.append(f"| {line}")
        
        # If content was censored, log both raw and censored versions
        if fields.get("raw_content") is not None:
            lines.append("Raw content (before censoring):")
            for line in unescape(fields["raw_content"]).splitlines():
                lines.append(f"| {line}")
            lines.append("Censored content (stored):")
            for line in unescape(fields.get("censored_content", fields.get("content", ""))).splitlines():
                lines.append(f"| {line}")
        elif fields.get("content"):
            lines.append("New content:")
            for line in unescape(fields["content"] or "").splitlines() or [""]:
                lines.append(f"| {line}")
        
        return lines
    if action == "message_deleted":
        lines = [
            f"Message #{fields.get('message_id')} deleted",
            f"Actor: {_format_actor(fields, 'actor')}",
        ]
        if fields.get("original_author_id") is not None:
            lines.append(f"Original author: user #{fields['original_author_id']}")
        if fields.get("content"):
            lines.append("Previous content:")
            for line in unescape(fields["content"]).splitlines():
                lines.append(f"| {line}")
        return lines
    if action == "reaction_update":
        lines = [
            f"Reaction {fields.get('action', 'updated')} on message #{fields.get('message_id')}",
            f"User: {_format_user(fields)}",
        ]
        if fields.get("emoji"):
            lines.append(f"Emoji: {fields['emoji']}")
        return lines
    return [f"{action.replace('_', ' ').capitalize()}"] + [
        f"{key.replace('_', ' ').capitalize()}: {value}"
        for key, value in fields.items()
        if value is not None
    ]


def _render_dm(action: str, fields: Dict[str, Any]) -> List[str]:
    if action in {"message_sent", "message_sent_ws"}:
        lines = [
            f"Direct message #{fields.get('dm_envelope_id')} sent",
            f"Sender: {_format_actor(fields, 'sender')}",
        ]
        if fields.get("recipient_id") is not None:
            lines.append(f"Recipient: user id {fields['recipient_id']}")
        attachments = fields.get("attachment_count")
        if attachments:
            lines.append(f"Attachments: {_plural('file', attachments)}")
        if fields.get("reply_to"):
            lines.append(f"In reply to DM #{fields['reply_to']}")
        return lines
    if action == "message_edited":
        return [
            f"Direct message #{fields.get('dm_envelope_id')} edited",
            f"Author: {_format_user(fields)}",
        ]
    if action == "message_deleted":
        lines = [
            f"Direct message #{fields.get('dm_envelope_id')} deleted",
            f"Actor: {_format_user(fields)}",
        ]
        if fields.get("recipient_id") is not None:
            lines.append(f"Recipient: user id {fields['recipient_id']}")
        return lines
    if action == "reaction_update":
        lines = [
            f"Reaction {fields.get('action', 'updated')} on DM #{fields.get('dm_envelope_id')}",
            f"User: {_format_user(fields)}",
        ]
        if fields.get("emoji"):
            lines.append(f"Emoji: {fields['emoji']}")
        return lines
    return [f"{action.replace('_', ' ').capitalize()}"] + [
        f"{key.replace('_', ' ').capitalize()}: {value}"
        for key, value in fields.items()
        if value is not None
    ]


def _render_access(action: str, fields: Dict[str, Any]) -> List[str]:
    ip_raw = fields.get("ip")
    ip_display = "localhost" if ip_raw in {"127.0.0.1", "::1"} else ip_raw
    if action == "http_request":
        first_line = f"{fields.get('method')} {fields.get('path')}"
        if ip_display:
            first_line += f" from {ip_display}"
        first_line += f" -> {fields.get('status')}"
        lines = [first_line]
        if fields.get("user"):
            lines.append(f"Authenticated user: {_clean_username(fields['user'])}")
        return lines
    if action == "http_error":
        first_line = f"HTTP error during {fields.get('method')} {fields.get('path')}"
        if ip_display:
            first_line += f" from {ip_display}"
        lines = [first_line]
        if fields.get("error"):
            lines.append(f"Exception: {fields['error']}")
        if fields.get("user"):
            lines.append(f"Authenticated user: {_clean_username(fields['user'])}")
        return lines
    if action == "ws_connect":
        lines = ["WebSocket connected"]
        if fields.get("path"):
            lines.append(f"Endpoint: {fields['path']}")
        if ip_display:
            lines.append(f"IP: {ip_display}")
        return lines
    if action == "ws_disconnect":
        lines = ["WebSocket disconnected"]
        if fields.get("path"):
            lines.append(f"Endpoint: {fields['path']}")
        if fields.get("code") is not None:
            reason = fields.get("reason") or "no reason"
            lines.append(f"Code {fields['code']} ({reason})")
        if ip_display:
            lines.append(f"IP: {ip_display}")
        return lines
    if action == "ws_event":
        event_name = fields.get("event")
        path = fields.get("path")
        first_line = "WS"
        if path:
            first_line += f" {path}"
        if ip_display:
            first_line += f" from {ip_display}"
        if event_name:
            first_line += f" -> {event_name}"
        lines = [first_line]
        if fields.get("user"):
            lines.append(f"Authenticated user: {_format_user(fields, 'user', 'user_id')}")
        for key, value in fields.items():
            if key in {"path", "event", "user", "user_id", "ip"} or value is None:
                continue
            lines.append(f"{key.replace('_', ' ').capitalize()}: {value}")
        return lines
    return [f"{action.replace('_', ' ').capitalize()}"] + [
        f"{key.replace('_', ' ').capitalize()}: {value}"
        for key, value in fields.items()
        if value is not None
    ]


def _log_event(
    logger: logging.Logger,
    renderer: Callable[[str, Dict[str, Any]], List[str]],
    action: str,
    severity: str,
    fields: Dict[str, Any],
) -> None:
    lines = renderer(action, fields)
    if not lines:
        return
    level = getattr(logging, severity.upper(), logging.INFO)
    logger.log(level, "\n".join(lines))


def log_security(action: str, severity: str = "info", **fields: Any) -> None:
    _log_event(security_logger, _render_security, action, severity, fields)


def log_public_chat(action: str, severity: str = "info", **fields: Any) -> None:
    _log_event(public_chat_logger, _render_public_chat, action, severity, fields)


def log_dm(action: str, severity: str = "info", **fields: Any) -> None:
    sanitized_fields = {key: value for key, value in fields.items() if key != "content"}
    _log_event(dm_logger, _render_dm, action, severity, sanitized_fields)


def log_access(action: str, severity: str = "info", **fields: Any) -> None:
    _log_event(access_logger, _render_access, action, severity, fields)

