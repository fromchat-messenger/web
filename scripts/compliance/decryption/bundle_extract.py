from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List

from http_client import http_get_bytes, http_get_json, join_api_url
from utils import safe_filename


def _fetch_user_profile(api_base_url: str, token: str, user_id: int) -> Dict[str, Any]:
    url = f"{api_base_url.rstrip('/')}/user/id/{user_id}"
    data = http_get_json(url, token)
    return data if isinstance(data, dict) else {}


def extract_single_message_to_bundle(api_base_url: str, token: str, message_id: int, bundle_root: str) -> Dict[str, Any]:
    message_dir = os.path.join(bundle_root, "messages", str(message_id))
    files_dir = os.path.join(message_dir, "files")
    os.makedirs(files_dir, exist_ok=True)

    extract_url = f"{api_base_url.rstrip('/')}/dm/compliance/extract/{message_id}"
    payload = http_get_json(extract_url, token)

    raw_path = os.path.join(message_dir, "response.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected response format for message_id={message_id}: missing 'data' object")

    msg_path = os.path.join(message_dir, "message.json")
    with open(msg_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    sender_id = data.get("sender_id")
    recipient_id = data.get("recipient_id")
    if not isinstance(sender_id, int) or not isinstance(recipient_id, int):
        raise RuntimeError(f"Extraction JSON missing sender_id/recipient_id for message_id={message_id}")

    sender_profile = _fetch_user_profile(api_base_url, token, sender_id)
    recipient_profile = _fetch_user_profile(api_base_url, token, recipient_id)
    sender_username = sender_profile.get("username") if isinstance(sender_profile.get("username"), str) else None
    sender_display_name = sender_profile.get("display_name") if isinstance(sender_profile.get("display_name"), str) else None
    recipient_username = recipient_profile.get("username") if isinstance(recipient_profile.get("username"), str) else None
    recipient_display_name = (
        recipient_profile.get("display_name") if isinstance(recipient_profile.get("display_name"), str) else None
    )

    sender_pk_url = f"{api_base_url.rstrip('/')}/crypto/public-key/of/{sender_id}"
    sender_pk_resp = http_get_json(sender_pk_url, token)
    sender_public_key_b64 = sender_pk_resp.get("publicKey")
    if not isinstance(sender_public_key_b64, str) or not sender_public_key_b64:
        raise RuntimeError(f"Could not fetch sender public key for user_id={sender_id}")

    files = data.get("files") or []
    if not isinstance(files, list):
        files = []

    file_entries: list[Dict[str, Any]] = []

    for fmeta in files:
        if not isinstance(fmeta, dict):
            continue
        file_id = fmeta.get("id")
        name = fmeta.get("name") or "file"
        path = fmeta.get("path")
        wrapped_mek_b64 = fmeta.get("wrapped_mek_b64")
        nonce_b64 = fmeta.get("nonce_b64")
        if not path or not isinstance(path, str):
            continue

        safe_name = safe_filename(str(name))
        enc_filename = f"{message_id}_{file_id or 'x'}_{safe_name}.enc"
        enc_abs = os.path.join(files_dir, enc_filename)
        enc_rel = os.path.relpath(enc_abs, bundle_root)

        file_url = join_api_url(api_base_url, path)
        file_bytes = http_get_bytes(file_url, token, timeout_seconds=60.0)
        with open(enc_abs, "wb") as outf:
            outf.write(file_bytes)

        envelope_compliance_mek = data.get("compliance_wrapped_mek_b64")
        use_compliance_mek = (
            isinstance(envelope_compliance_mek, str)
            and envelope_compliance_mek
            and wrapped_mek_b64 == envelope_compliance_mek
        )
        meta_out: Dict[str, Any] = {
            "kind": "dm_file",
            "message_id": data.get("message_id"),
            "dm_file_id": file_id,
            "filename": name,
            "path": path,
            "nonce_b64": nonce_b64,
            "encrypted_file_local": enc_rel,
        }
        if use_compliance_mek:
            meta_out["compliance_wrapped_mek_b64"] = wrapped_mek_b64
        else:
            meta_out["wrapped_mek_b64"] = wrapped_mek_b64
            meta_out["wrap_context"] = "sender_wrap_key"
            meta_out["wrap_public_key_b64"] = sender_public_key_b64
        meta_filename = f"{message_id}_{file_id or 'x'}_{safe_name}.meta.json"
        meta_abs = os.path.join(files_dir, meta_filename)
        meta_rel = os.path.relpath(meta_abs, bundle_root)
        with open(meta_abs, "w", encoding="utf-8") as mf:
            json.dump(meta_out, mf, ensure_ascii=False, indent=2)

        file_entries.append(
            {
                "dm_file_id": file_id,
                "filename": name,
                "encrypted_file": enc_rel,
                "meta_file": meta_rel,
                "size_bytes": len(file_bytes),
            }
        )

    # Handle edit history
    edit_history = data.get("edit_history") or []
    if not isinstance(edit_history, list):
        edit_history = []

    edit_history_entries: list[Dict[str, Any]] = []

    for edit_entry in edit_history:
        if not isinstance(edit_entry, dict):
            continue

        edit_id = edit_entry.get("edit_id")
        edit_timestamp = edit_entry.get("edited_at")
        edited_by_user_id = edit_entry.get("edited_by_user_id")
        edited_by_username = edit_entry.get("edited_by_username")

        if not isinstance(edit_id, int) or not isinstance(edit_timestamp, str):
            continue

        # Create separate JSON file for each edit history entry
        edit_data = {
            "edit_id": edit_id,
            "message_id": message_id,
            "edited_at": edit_timestamp,
            "edited_by_user_id": edited_by_user_id,
            "edited_by_username": edited_by_username,
            "previous_ciphertext_b64": edit_entry.get("previous_ciphertext_b64"),
            "previous_iv_b64": edit_entry.get("previous_iv_b64"),
            "previous_compliance_wrapped_mek_b64": edit_entry.get("previous_compliance_wrapped_mek_b64"),
        }

        edit_filename = f"edit_{edit_id}.json"
        edit_path = os.path.join(message_dir, "edits", edit_filename)
        os.makedirs(os.path.dirname(edit_path), exist_ok=True)
        edit_rel = os.path.relpath(edit_path, bundle_root)

        with open(edit_path, "w", encoding="utf-8") as f:
            json.dump(edit_data, f, ensure_ascii=False, indent=2)

        edit_history_entries.append({
            "edit_id": edit_id,
            "edit_data_file": edit_rel,
            "edited_at": edit_timestamp,
            "edited_by_user_id": edited_by_user_id,
            "edited_by_username": edited_by_username,
        })

    return {
        "message_id": message_id,
        "message_data_file": os.path.relpath(msg_path, bundle_root),
        "response_file": os.path.relpath(raw_path, bundle_root),
        "sender_id": sender_id,
        "sender_username": sender_username,
        "sender_display_name": sender_display_name,
        "recipient_id": recipient_id,
        "recipient_username": recipient_username,
        "recipient_display_name": recipient_display_name,
        "timestamp": data.get("timestamp"),
        "files": file_entries,
        "edit_history": edit_history_entries,
    }


def extract_bundle(api_base_url: str, token: str, message_ids: List[int], out_dir: str) -> str:
    os.makedirs(os.path.join(out_dir, "messages"), exist_ok=True)

    seen: set[int] = set()
    unique_ids: list[int] = []
    for mid in message_ids:
        if mid not in seen:
            seen.add(mid)
            unique_ids.append(mid)
    if not unique_ids:
        raise RuntimeError("No message IDs provided")

    manifest: Dict[str, Any] = {
        "bundle_version": 1,
        "generated_at": datetime.now().isoformat(),
        "api_base_url": api_base_url.rstrip("/"),
        "messages": [],
    }

    for mid in unique_ids:
        entry = extract_single_message_to_bundle(api_base_url, token, mid, out_dir)
        manifest["messages"].append(entry)

    manifest_path = os.path.join(out_dir, "bundle.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return manifest_path

