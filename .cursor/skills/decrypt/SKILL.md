---
name: decrypt
description: Decrypts a DM message on localhost by granting temporary compliance extract access, running extract and decrypt CLI commands, then reverting all temporary changes. Use when the user asks to decrypt a message or run the compliance decryption workflow on localhost.
---

# Decrypt (local debug)

End-to-end workflow for extracting and decrypting one message on **localhost**. All temporary backend access must be removed when finished.

**After decrypt:** what to do with the plaintext and files (compare, inspect, report, etc.) comes from the **current conversation** — not from this skill.

## Prerequisites

- Web dev server running at `http://localhost:8301` (browser rules default).
- `compliance_keypair.txt` at the Web repo root (`Web/compliance_keypair.txt`).
- Python deps for `scripts/compliance/decryption/` (`cryptography`, etc.).

## Step 0 — Read the compliance keypair

Read `Web/compliance_keypair.txt` before any decrypt step. Confirm the **private** key line exists (line after `PRIVATE KEY` header, base64).

The decrypt CLI loads `compliance_keypair.txt` from the **current working directory**. Always run extract/decrypt with `cd` to the Web repo root:

```bash
cd /path/to/Web
```

If `load_compliance_private_key` fails, the file format may need a `PRIVATE_KEY=<base64>` line (the loader expects that or a 43-char base64 line; 32-byte keys are often 44 chars with padding).

## Step 1 — Create a temporary user and capture token

Generate random credentials (username 3–20 chars: letters, digits, `-`, `_`; password 5–50 chars, no spaces):

```bash
DEBUG_USER="decryptdbg$(openssl rand -hex 3)"
DEBUG_PASS="$(openssl rand -base64 12 | tr -d '/+=' | head -c 16)"
echo "user=$DEBUG_USER pass=$DEBUG_PASS"
```

Register and save **`token`** from the JSON response (not the derived login secret):

```bash
REGISTER_JSON=$(curl -sS -X POST "http://localhost:8301/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${DEBUG_USER}\",\"display_name\":\"DecryptDebug\",\"password\":\"${DEBUG_PASS}\",\"confirm_password\":\"${DEBUG_PASS}\"}")
echo "$REGISTER_JSON"
DEBUG_TOKEN=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<< "$REGISTER_JSON")
echo "token saved (length ${#DEBUG_TOKEN})"
```

Alternatively export for the CLI: `export FROMCHAT_API_TOKEN="${DEBUG_TOKEN}"`

Save `user.id` from the same JSON if needed for debugging.

## Step 2 — Temporary compliance extract permission (marker blocks)

`GET /api/dm/compliance/extract/{message_id}` is restricted to **user id 1** in:

`backend/services/main/routes/envelope_messaging.py` (function `extract_message_for_compliance`).

Add a **temporary** bypass between searchable markers (replace `DEBUG_USERNAME` with the user from step 1):

```python
    # TEMP_COMPLIANCE_DEBUG_START — remove after decrypt debug run
    _TEMP_COMPLIANCE_DEBUG_USERNAMES = {"DEBUG_USERNAME"}
    # TEMP_COMPLIANCE_DEBUG_END

    # Security check: only user ID 1 can access this
    if current_user.id != 1 and current_user.username not in _TEMP_COMPLIANCE_DEBUG_USERNAMES:
```

Backend will auto-reload after this change, you don't need to do anything.

To remove later: search the repo for `TEMP_COMPLIANCE_DEBUG` and delete the marker block + revert the `if` to only `current_user.id != 1`.

## Step 3 — Extract bundle (online)

From Web repo root, set variables and run (user supplies `MESSAGE_ID`):

```bash
MESSAGE_ID=<message_id>
RANDOM_FOLDER="run_$(openssl rand -hex 4)"
BUNDLE_DIR="/tmp/debug_decrypt/${RANDOM_FOLDER}"
DECRYPT_DIR="/tmp/debug_decrypt/${RANDOM_FOLDER}_dec"
mkdir -p /tmp/debug_decrypt

cd /path/to/Web
python scripts/compliance/decryption/main.py extract \
  --server localhost:8301 \
  --http \
  --token "${DEBUG_TOKEN}" \
  --message-ids "${MESSAGE_ID}" \
  --out-dir "${BUNDLE_DIR}"
```

Equivalent using env (no `--token` flag):

```bash
export FROMCHAT_API_TOKEN="${DEBUG_TOKEN}"
python scripts/compliance/decryption/main.py extract \
  --server localhost:8301 \
  --http \
  --message-ids "${MESSAGE_ID}" \
  --out-dir "${BUNDLE_DIR}"
```

Confirm `${BUNDLE_DIR}/bundle.json` exists.

**Auth flags:** use `--token` (Bearer from register/login), or `--username` + `--password` (CLI derives the login secret). Do not pass both.

## Step 4 — Decrypt bundle (offline)

Still from Web repo root (`compliance_keypair.txt` must resolve):

```bash
python scripts/compliance/decryption/main.py decrypt \
  --bundle-dir "${BUNDLE_DIR}" \
  --output-dir "${DECRYPT_DIR}"
```

Outputs:

- `${DECRYPT_DIR}/messages/<message_id>/message.decrypted.txt` — message plaintext
- `${DECRYPT_DIR}/messages/<message_id>/files/` — decrypted attachments
- `${DECRYPT_DIR}/index.html` — HTML report

## Step 5 — Use decrypted output (conversation-driven)

Follow the **user’s request in the current chat** for what to do next (e.g. compare hashes, inspect text, verify a specific attachment). This skill stops at producing `${DECRYPT_DIR}`; do not assume a fixed post-decrypt task.

## Step 6 — Cleanup (required)

1. **Remove decrypt dirs:**
   ```bash
   rm -rf "${BUNDLE_DIR}" "${DECRYPT_DIR}"
   ```

2. **Delete temp user** (local SQLite default DB):
   ```bash
   sqlite3 backend/data/database.db "DELETE FROM users WHERE username='${DEBUG_USER}';"
   ```
   If your deployment uses another DB, delete the same username there.         

3. **Remove temporary permission:** search `TEMP_COMPLIANCE_DEBUG` in the repo, delete the marker block, restore the original `if current_user.id != 1:` check, restart backend.                                  

4. Do **not** commit `compliance_keypair.txt` or any decrypt output.

## Checklist

```
- [ ] Read compliance_keypair.txt
- [ ] Register DEBUG_USER; save DEBUG_TOKEN from response
- [ ] Add TEMP_COMPLIANCE_DEBUG_* bypass; restart backend
- [ ] extract --token → bundle.json present
- [ ] decrypt → output under DECRYPT_DIR
- [ ] Post-decrypt work per conversation context
- [ ] rm -rf BUNDLE_DIR and DECRYPT_DIR
- [ ] DELETE temp user from DB
- [ ] Remove TEMP_COMPLIANCE_DEBUG markers; restart backend
```

## Reference

- Extract API: `GET /api/dm/compliance/extract/{message_id}` (see `bundle_extract.py`).
- Decrypt implementation: `scripts/compliance/decryption/bundle_decrypt.py`, `crypto.py`.
- Extract auth: `--token` (Bearer), env `FROMCHAT_API_TOKEN` / `FROMCHAT_TOKEN`, or `--username` + plain `--password` (CLI calls `derive_auth_secret` for login only).

## Rules
- NEVER use sleep in any command.
- Set a timeout on EVERY command that may request user input.
