from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from crypto import decrypt_file_bytes_from_meta, decrypt_message, load_compliance_private_key
from report_assets import write_assets
from utils import guess_is_image, html_escape, href_escape, parse_message_plaintext, safe_filename


@dataclass(frozen=True)
class Attachment:
    filename: str
    output_rel: str
    size_bytes: int
    is_image: bool


@dataclass(frozen=True)
class DecryptedMessage:
    message_id: int
    sender_id: int
    sender_label: str
    recipient_id: int
    recipient_label: str
    timestamp: str
    text: str
    attachments: List[Attachment]
    edit_history: List['DecryptedEdit'] = None

    def __post_init__(self):
        if self.edit_history is None:
            object.__setattr__(self, 'edit_history', [])


@dataclass(frozen=True)
class DecryptedEdit:
    edit_id: int
    edited_at: str
    edited_by_user_id: int
    edited_by_username: str
    previous_text: str


def _load_manifest(bundle_dir: Path) -> Dict[str, Any]:
    manifest_path = bundle_dir / "bundle.json"
    if not manifest_path.exists():
        raise RuntimeError(f"bundle.json not found in: {bundle_dir}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _parse_timestamp_day(ts: str) -> str:
    return (ts or "")[:10] if isinstance(ts, str) and len(ts) >= 10 else ""


def _format_ts(ts: str) -> str:
    raw = (ts or "").strip()
    if not raw:
        return ""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%d.%m.%Y %H:%M:%S")
    except Exception:
        return raw


def _format_time(ts: str) -> str:
    raw = (ts or "").strip()
    if not raw:
        return ""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%H:%M:%S")
    except Exception:
        return raw


def _format_day(ts: str) -> str:
    raw = (ts or "").strip()
    if not raw:
        return ""
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%d.%m.%Y")
    except Exception:
        return _parse_timestamp_day(raw)


def _conversation_key(sender_id: int, recipient_id: int) -> Tuple[int, int]:
    a, b = int(sender_id), int(recipient_id)
    return (a, b) if a < b else (b, a)


def _best_username(username: str | None, display_name: str | None, user_id: int) -> str:
    u = (username or "").strip()
    if u:
        return u
    d = (display_name or "").strip()
    if d:
        return d
    return f"user{user_id}"


def _format_user_label(username: str | None, display_name: str | None, user_id: int) -> str:
    return f"{_best_username(username, display_name, user_id)} (#{user_id})"


def _format_bytes(n: int) -> str:
    try:
        size = float(int(n))
    except Exception:
        return f"{n} B"

    units = ["B", "KB", "MB", "GB", "TB"]
    unit = units[0]
    for u in units:
        unit = u
        if size < 1024.0 or u == units[-1]:
            break
        size /= 1024.0

    if unit == "B":
        return f"{int(size)} B"
    if size >= 100:
        return f"{size:.0f} {unit}"
    if size >= 10:
        return f"{size:.1f} {unit}"
    return f"{size:.2f} {unit}"


def _render_report(
    out_dir: Path,
    conversations: Dict[Tuple[int, int], List[DecryptedMessage]],
    conversation_names: Dict[Tuple[int, int], Tuple[str, str]],
    css_href: str,
    js_src: str,
) -> None:
    total_messages = sum(len(v) for v in conversations.values())
    now = datetime.now().strftime("%d.%m.%Y %H:%M:%S")

    parts: list[str] = []
    parts.append("<!doctype html>")
    parts.append("<html lang=\"en\">")
    parts.append("<head>")
    parts.append("<meta charset=\"utf-8\"/>")
    parts.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>")
    parts.append("<title>FromChat Compliance Bundle</title>")
    parts.append(f"<link rel=\"stylesheet\" href=\"{html_escape(css_href)}\"/>")
    parts.append(f"<script src=\"{html_escape(js_src)}\" defer></script>")
    parts.append("</head>")
    parts.append("<body>")
    parts.append("<div class=\"topbar\">")
    parts.append("<div class=\"topbar-inner\">")
    parts.append("<div class=\"brand\">")
    parts.append("<div class=\"brand-title\">FromChat compliance bundle</div>")
    parts.append(f"<div class=\"brand-subtitle\">Decrypted at: {html_escape(now)} • Messages: {total_messages}</div>")
    parts.append("</div>")
    parts.append("<div class=\"tools\">")
    parts.append("<input id=\"searchInput\" class=\"search\" placeholder=\"Search messages / filenames / user ids\"/>")
    parts.append("<div id=\"filterHint\" class=\"hint\">Type to filter by text, user id, filename</div>")
    parts.append("</div>")
    parts.append("</div>")
    parts.append("</div>")
    parts.append("<div class=\"wrap\">")

    for (left_id, right_id), msgs in sorted(conversations.items(), key=lambda x: x[0]):
        msgs_sorted = sorted(msgs, key=lambda m: (m.timestamp, m.message_id))
        left_name, right_name = conversation_names.get((left_id, right_id), (str(left_id), str(right_id)))
        conv_title = f"Conversation: {left_name} ↔ {right_name}"
        conv_sub = f"{len(msgs_sorted)} message(s)"
        parts.append(f"<div class=\"conversation\" data-conv=\"{left_id}-{right_id}\">")
        parts.append("<div class=\"conv-header\">")
        parts.append("<div class=\"conv-title\">")
        parts.append(f"<div class=\"line1\">{html_escape(conv_title)}</div>")
        parts.append(f"<div class=\"line2\">{html_escape(conv_sub)}</div>")
        parts.append("</div>")
        parts.append("</div>")

        parts.append("<div class=\"messages\">")
        current_day = ""
        for m in msgs_sorted:
            day = _format_day(m.timestamp)
            if day and day != current_day:
                current_day = day
                parts.append("<div class=\"day\"><span>")
                parts.append(html_escape(day))
                parts.append("</span></div>")

            searchable = (
                f"{m.message_id} {m.sender_id} {m.sender_label} {m.recipient_id} {m.recipient_label} {m.timestamp} {m.text} "
                + " ".join(a.filename for a in m.attachments)
            )

            # Create container for message with edit history
            parts.append(f"<div class=\"message-container\" data-search=\"{html_escape(searchable)}\">")

            # Edit history tabs (vertical on the left)
            if m.edit_history:
                parts.append("<div class=\"edit-tabs-vertical\">")

                # Add current version as "Latest" (most recent, at top)
                latest_timestamp = max(edit.edited_at for edit in m.edit_history)
                latest_datetime = _format_day(latest_timestamp) + " " + _format_time(latest_timestamp)
                parts.append(f"<div class=\"tab-vertical active\" data-version=\"latest\" data-message-id=\"{m.message_id}\" data-timestamp=\"{latest_timestamp}\">")
                parts.append("<div class=\"tab-label-vertical\">Latest</div>")
                parts.append(f"<div class=\"tab-time-vertical\" data-timestamp=\"{latest_timestamp}\">{html_escape(latest_datetime)}</div>")
                parts.append("</div>")

                # Add edit history tabs in reverse chronological order (most recent first)
                for i, edit in enumerate(reversed(m.edit_history)):
                    version_num = len(m.edit_history) - i
                    tab_label = f"v{version_num}"
                    # Each version tab shows when that version was created
                    tab_timestamp = m.timestamp if version_num == 1 else m.edit_history[version_num-2].edited_at
                    tab_datetime = _format_day(tab_timestamp) + " " + _format_time(tab_timestamp)
                    parts.append(f"<div class=\"tab-vertical\" data-version=\"edit-{edit.edit_id}\" data-message-id=\"{m.message_id}\" data-timestamp=\"{tab_timestamp}\">")
                    parts.append(f"<div class=\"tab-label-vertical\">{html_escape(tab_label)}</div>")
                    parts.append(f"<div class=\"tab-time-vertical\" data-timestamp=\"{tab_timestamp}\">{html_escape(tab_datetime)}</div>")
                    parts.append("</div>")

                parts.append("</div>")  # end tabs

            # Message bubble container
            parts.append("<div class=\"bubble-area\">")

            # Current version bubble
            parts.append(f"<div class=\"bubble active\" data-version=\"latest\" data-message-id=\"{m.message_id}\">")
            parts.append("<div class=\"bubble-header\">")
            parts.append(
                f"<div class=\"who\"><strong>{html_escape(m.sender_label)}</strong> → {html_escape(m.recipient_label)}</div>"
            )
            parts.append("</div>")
            parts.append(f"<div class=\"text\">{html_escape(m.text)}</div>")

            if m.attachments:
                parts.append("<div class=\"attachments\">")
                for a in m.attachments:
                    rel = href_escape(a.output_rel)
                    parts.append("<div class=\"att\">")
                    parts.append(f"<div class=\"att-name\">{html_escape(a.filename)}</div>")
                    if a.is_image:
                        parts.append(
                            f"<a href=\"{html_escape(rel)}\"><img class=\"thumb\" src=\"{html_escape(rel)}\" alt=\"{html_escape(a.filename)}\"/></a>"
                        )
                    parts.append("<div class=\"att-actions\">")
                    parts.append(f"<a href=\"{html_escape(rel)}\" download>Download</a>")
                    parts.append(f"<span class=\"att-size\">{html_escape(_format_bytes(a.size_bytes))}</span>")
                    parts.append("</div>")
                    parts.append("</div>")
                parts.append("</div>")

            parts.append("<div class=\"msg-meta\">")
            parts.append(f"<div class=\"msg-meta-left\">#{m.message_id}</div>")
            latest_edit_time = max(edit.edited_at for edit in m.edit_history) if m.edit_history else m.timestamp
            parts.append(f"<div class=\"msg-meta-right\" data-timestamp=\"{latest_edit_time}\">{html_escape(_format_time(latest_edit_time))}</div>")
            parts.append("</div>")
            parts.append("</div>")

            # Edit history bubbles
            for i, edit in enumerate(m.edit_history):
                version_num = i + 1
                # Calculate the timestamp when this version was active
                bubble_timestamp = m.timestamp if i == 0 else m.edit_history[i-1].edited_at

                parts.append(f"<div class=\"bubble\" data-version=\"edit-{edit.edit_id}\" data-message-id=\"{m.message_id}\">")
                parts.append("<div class=\"bubble-header\">")
                parts.append(
                    f"<div class=\"who\"><strong>{html_escape(m.sender_label)}</strong> → {html_escape(m.recipient_label)}</div>"
                )
                parts.append("</div>")
                parts.append(f"<div class=\"text\">{html_escape(edit.previous_text)}</div>")

                if m.attachments:
                    parts.append("<div class=\"attachments\">")
                    for a in m.attachments:
                        rel = href_escape(a.output_rel)
                        parts.append("<div class=\"att\">")
                        parts.append(f"<div class=\"att-name\">{html_escape(a.filename)}</div>")
                        if a.is_image:
                            parts.append(
                                f"<a href=\"{html_escape(rel)}\"><img class=\"thumb\" src=\"{html_escape(rel)}\" alt=\"{html_escape(a.filename)}\"/></a>"
                            )
                        parts.append("<div class=\"att-actions\">")
                        parts.append(f"<a href=\"{html_escape(rel)}\" download>Download</a>")
                        parts.append(f"<span class=\"att-size\">{html_escape(_format_bytes(a.size_bytes))}</span>")
                        parts.append("</div>")
                        parts.append("</div>")
                    parts.append("</div>")

                parts.append("<div class=\"msg-meta\">")
                parts.append(f"<div class=\"msg-meta-left\">#{m.message_id}</div>")
                parts.append(f"<div class=\"msg-meta-right\" data-timestamp=\"{bubble_timestamp}\">{html_escape(_format_time(bubble_timestamp))}</div>")
                parts.append("</div>")
                parts.append("</div>")

            parts.append("</div>")  # end bubble-area
            parts.append("</div>")  # end message-container

        parts.append("</div>")
        parts.append("</div>")

    parts.append("<div class=\"footer\">⚠️ This content has been accessed for compliance purposes. Handle and destroy according to policy.</div>")
    parts.append("</div>")
    parts.append("</body></html>")

    (out_dir / "index.html").write_text("\n".join(parts), encoding="utf-8")


def decrypt_bundle(bundle_dir: str, output_dir: str, *, key_file: str = "compliance_keypair.txt") -> str:
    bundle_path = Path(bundle_dir).resolve()
    out_path = Path(output_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)

    manifest = _load_manifest(bundle_path)
    messages = manifest.get("messages") if isinstance(manifest, dict) else None
    if not isinstance(messages, list) or not messages:
        raise RuntimeError("bundle.json has no messages")

    compliance_private_key = load_compliance_private_key(key_file=key_file)
    compliance_public_key = compliance_private_key.public_key()

    conversations: Dict[Tuple[int, int], List[DecryptedMessage]] = {}
    conversation_names: Dict[Tuple[int, int], Tuple[str, str]] = {}

    for entry in messages:
        if not isinstance(entry, dict):
            continue

        message_id = entry.get("message_id")
        msg_file = entry.get("message_data_file")
        if not isinstance(message_id, int) or not isinstance(msg_file, str):
            continue

        msg_abs = bundle_path / msg_file
        message_data = json.loads(msg_abs.read_text(encoding="utf-8"))
        if not isinstance(message_data, dict):
            continue

        plaintext = decrypt_message(message_data, compliance_private_key, compliance_public_key)
        parsed = parse_message_plaintext(plaintext)
        text = parsed.get("text") or plaintext

        msg_out_dir = out_path / "messages" / str(message_id)
        msg_files_out_dir = msg_out_dir / "files"
        msg_files_out_dir.mkdir(parents=True, exist_ok=True)

        (msg_out_dir / "message.decrypted.txt").write_text(plaintext, encoding="utf-8")
        (msg_out_dir / "message.decrypted.json").write_text(
            json.dumps(
                {
                    "message_id": message_id,
                    "sender_id": message_data.get("sender_id"),
                    "recipient_id": message_data.get("recipient_id"),
                    "timestamp": message_data.get("timestamp"),
                    "plaintext": plaintext,
                    "parsed": parsed,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        sender_id = int(message_data.get("sender_id") or 0)
        recipient_id = int(message_data.get("recipient_id") or 0)
        ts = str(message_data.get("timestamp") or "")

        sender_username = entry.get("sender_username") if isinstance(entry.get("sender_username"), str) else None
        sender_display_name = entry.get("sender_display_name") if isinstance(entry.get("sender_display_name"), str) else None
        recipient_username = entry.get("recipient_username") if isinstance(entry.get("recipient_username"), str) else None
        recipient_display_name = (
            entry.get("recipient_display_name") if isinstance(entry.get("recipient_display_name"), str) else None
        )

        sender_label = _format_user_label(sender_username, sender_display_name, sender_id)
        recipient_label = _format_user_label(recipient_username, recipient_display_name, recipient_id)

        # Process edit history
        edit_history: list[DecryptedEdit] = []
        entry_edits = entry.get("edit_history")
        if isinstance(entry_edits, list):
            for edit_entry in entry_edits:
                if not isinstance(edit_entry, dict):
                    continue

                edit_data_file = edit_entry.get("edit_data_file")
                if not isinstance(edit_data_file, str):
                    continue

                edit_abs = bundle_path / edit_data_file
                if not edit_abs.exists():
                    continue

                edit_data = json.loads(edit_abs.read_text(encoding="utf-8"))
                if not isinstance(edit_data, dict):
                    continue

                # Decrypt the previous version of the message
                previous_message_data = {
                    "sender_id": sender_id,
                    "recipient_id": recipient_id,
                    "timestamp": edit_data.get("edited_at"),
                    "iv_b64": edit_data.get("previous_iv_b64"),
                    "ciphertext_b64": edit_data.get("previous_ciphertext_b64"),
                    "compliance_wrapped_mek_b64": edit_data.get("previous_compliance_wrapped_mek_b64"),
                }

                try:
                    previous_plaintext = decrypt_message(previous_message_data, compliance_private_key, compliance_public_key)
                    previous_parsed = parse_message_plaintext(previous_plaintext)
                    previous_text = previous_parsed.get("text") or previous_plaintext

                    # Save decrypted edit to output
                    edit_out_dir = msg_out_dir / "edits"
                    edit_out_dir.mkdir(parents=True, exist_ok=True)
                    edit_id = edit_data.get("edit_id")

                    (edit_out_dir / f"edit_{edit_id}.decrypted.txt").write_text(previous_plaintext, encoding="utf-8")
                    (edit_out_dir / f"edit_{edit_id}.decrypted.json").write_text(
                        json.dumps(
                            {
                                "edit_id": edit_id,
                                "message_id": message_id,
                                "edited_at": edit_data.get("edited_at"),
                                "edited_by_user_id": edit_data.get("edited_by_user_id"),
                                "edited_by_username": edit_data.get("edited_by_username"),
                                "plaintext": previous_plaintext,
                                "parsed": previous_parsed,
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        encoding="utf-8",
                    )

                    edit_history.append(DecryptedEdit(
                        edit_id=int(edit_id),
                        edited_at=str(edit_data.get("edited_at") or ""),
                        edited_by_user_id=int(edit_data.get("edited_by_user_id") or 0),
                        edited_by_username=str(edit_data.get("edited_by_username") or "unknown"),
                        previous_text=str(previous_text),
                    ))
                except Exception as e:
                    print(f"Failed to decrypt edit {edit_entry.get('edit_id')}: {e}")

        attachments: list[Attachment] = []

        entry_files = entry.get("files")
        if not isinstance(entry_files, list):
            entry_files = []

        for fentry in entry_files:
            if not isinstance(fentry, dict):
                continue
            meta_rel = fentry.get("meta_file")
            enc_rel = fentry.get("encrypted_file")
            if not isinstance(meta_rel, str) or not isinstance(enc_rel, str):
                continue

            meta_abs = bundle_path / meta_rel
            enc_abs = bundle_path / enc_rel
            if not meta_abs.exists() or not enc_abs.exists():
                continue

            meta = json.loads(meta_abs.read_text(encoding="utf-8"))
            if not isinstance(meta, dict):
                continue

            encrypted_bytes = enc_abs.read_bytes()
            decrypted_bytes = decrypt_file_bytes_from_meta(meta, encrypted_bytes, key_file=key_file)

            orig_name = str(meta.get("filename") or "file")
            safe_name = safe_filename(orig_name)
            out_file_abs = msg_files_out_dir / safe_name
            if out_file_abs.exists():
                root, ext = os.path.splitext(safe_name)
                out_file_abs = msg_files_out_dir / f"{root}_{meta.get('dm_file_id') or 'x'}{ext}"

            out_file_abs.write_bytes(decrypted_bytes)

            out_rel = os.path.relpath(out_file_abs, out_path)
            attachments.append(
                Attachment(
                    filename=orig_name,
                    output_rel=out_rel,
                    size_bytes=len(decrypted_bytes),
                    is_image=guess_is_image(orig_name),
                )
            )

        msg = DecryptedMessage(
            message_id=int(message_id),
            sender_id=sender_id,
            sender_label=sender_label,
            recipient_id=recipient_id,
            recipient_label=recipient_label,
            timestamp=ts,
            text=str(text),
            attachments=attachments,
            edit_history=edit_history,
        )

        conv_key = _conversation_key(sender_id, recipient_id)
        conversations.setdefault(conv_key, []).append(msg)
        if conv_key not in conversation_names:
            left_id, right_id = conv_key
            if sender_id == left_id:
                left_name = _best_username(sender_username, sender_display_name, left_id)
                right_name = _best_username(recipient_username, recipient_display_name, right_id)
            else:
                left_name = _best_username(recipient_username, recipient_display_name, left_id)
                right_name = _best_username(sender_username, sender_display_name, right_id)
            conversation_names[conv_key] = (left_name, right_name)

    css_rel, js_rel = write_assets(out_path)
    _render_report(out_path, conversations, conversation_names, css_rel, js_rel)

    return str(out_path / "index.html")

