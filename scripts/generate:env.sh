#!/bin/bash
# =============================================================================
# _ENV_TEMPLATE: one KEY=value per line. Use <set> for stdin prompts. Use
# <gen:…> only where a dedicated step is needed. Any $(command) here runs when
# this script executes (after cd "$ROOT"). Piped stdin order: four <set> lines
# (TURN_USERNAME, TURN_SECRET, DEPLOYMENT_SERVER, RELEASES_TOKEN),
# then commit (y/n), then deployment output directory (blank = deployment), then
# writes <dir>/.env and <dir>/compliance_keypair.txt (default dir: deployment); then
# if each target exists, backup prompt [Y/n] (Enter = yes; only n/no skips).
# Nothing is written until commit=y (including compliance_keypair.txt). Backups after commit=y, default yes.
# Backups use <original-path>.<6-char sha256>.bak (same contents reuse one file). If that
# name exists with different content, full 64-char hash is used before .bak.
# Template is read from fd 3 so stdin stays free.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

VENV_PY="${ROOT}/.venv/bin/python3"
ENV_PATH=""
COMPLIANCE_TXT=""
_COMPLIANCE_PRIVATE_B64=""
_COMPLIANCE_PUBLIC_B64=""

_ENV_TEMPLATE="$(cat <<EOF
$(.venv/bin/python3 backend/services/main/generate_vapid_keys.py </dev/null)
JWT_SECRET=$(openssl rand -base64 32 </dev/null | tr -d '\n')
COMPLIANCE_PUBLIC_KEY=<gen:compliance>
TURN_USERNAME=<set>
TURN_SECRET=<set>
DEPLOYMENT_SERVER=<set>
POSTGRES_PASSWORD=$(openssl rand -hex 8 </dev/null)
MAIN_DB_PASSWORD=$(openssl rand -hex 8 </dev/null)
MESSAGING_DB_PASSWORD=$(openssl rand -hex 8 </dev/null)
FILE_STORAGE_DB_PASSWORD=$(openssl rand -hex 8 </dev/null)
RELEASES_TOKEN=<set>
MESSAGE_RETENTION_DAYS=180
EOF
)"

# --- colors (key = light blue, = gray, value = purple) ---
NC=$'\033[0m'
GRAY=$'\033[38;5;245m'
BLUE=$'\033[38;5;81m'
PURPLE=$'\033[38;5;141m'
RED=$'\033[38;5;203m'
LIME=$'\033[38;5;154m'
ORANGE=$'\033[38;5;208m'
YELLOW=$'\033[38;5;226m'
CHECK=$'\033[38;5;154m'
WARN_ICON=$'\xe2\x9a\xa0'

_abort_on_int() {
  printf '\n\n%b%s %s%b\n' "$YELLOW" "$WARN_ICON" "Aborted." "$NC" >&2
  exit 130
}
trap _abort_on_int INT

# Buffered .env lines (written only after commit)
declare -a ENV_LINES=()

# label + label_color | KEY=value (KEY light blue, = gray, value purple)
print_kv_row() {
  local label="$1" label_c="$2" key="$3" val="$4"
  printf '%b%s%b %b|%b %b%s%b%b=%b%s%b\n' \
    "$label_c" "$label" "$NC" "$GRAY" "$NC" \
    "$BLUE" "$key" "$NC" "$GRAY" "$PURPLE" "$val" "$NC"
}

print_validation_error() {
  printf '%b%s %s%b\n' "$RED" "$WARN_ICON" "$1" "$NC" >&2
}

# Append one logical line to ENV_LINES (shell-safe quoting for .env file)
buffer_env_line() {
  local key="$1" val="$2"
  local line
  if [[ "$val" == *'"'* ]] || [[ "$val" == *' '* ]] || [[ "$val" == *'#'* ]] || [[ "$val" == *'='* ]] || [[ -z "$val" ]]; then
    local esc="${val//\\/\\\\}"
    esc="${esc//\"/\\\"}"
    line=$(printf '%s="%s"' "$key" "$esc")
  else
    line=$(printf '%s=%s' "$key" "$val")
  fi
  ENV_LINES+=("$line")
}

validate_ipv4() {
  local ip="$1" _IFS=$IFS IFS=.
  local -a oct=($ip)
  IFS="$_IFS"
  [[ ${#oct[@]} -eq 4 ]] || return 1
  local x
  for x in "${oct[@]}"; do
    [[ "$x" =~ ^[0-9]+$ ]] || return 1
    (( 10#$x >= 0 && 10#$x <= 255 )) || return 1
  done
  return 0
}

validate_deployment_server() {
  local v="$1"
  [[ -n "$v" ]] || return 1
  validate_ipv4 "$v"
}

validate_set_value() {
  local key="$1" val="$2"
  [[ -n "$val" ]] || return 1
  case "$key" in
    DEPLOYMENT_SERVER) validate_deployment_server "$val" ;;
    *) ;;
  esac
}

validation_hint() {
  case "$1" in
    DEPLOYMENT_SERVER)
      printf '%s' "Expected a valid IPv4 address (e.g. 192.168.1.1), four octets 0–255."
      ;;
    *)
      printf '%s' "Value must not be empty."
      ;;
  esac
}

prompt_set() {
  local key="$1"
  local val=""
  while true; do
    printf '%b%s%b %b|%b %b%s%b%b=%b' \
      "$ORANGE" "user input" "$NC" "$GRAY" "$NC" "$BLUE" "$key" "$NC" "$GRAY" "$NC" >&2
    IFS= read -r val || true
    if validate_set_value "$key" "$val"; then
      buffer_env_line "$key" "$val"
      break
    fi
    print_validation_error "$(validation_hint "$key")"
    if [[ ! -t 0 ]]; then
      printf '%s\n' "generate:env: invalid value for ${key} (piped stdin); aborting." >&2
      exit 1
    fi
  done
}

# Backup path: {src}.{short-hash}.bak, or {src}.{full-hash}.bak on short-hash collision
_do_backup_copy() {
  local src="$1"
  local full short dest
  full="$(openssl dgst -sha256 -r <"$src" | awk '{print $1}')"
  short="${full:0:6}"
  dest="${src}.${short}.bak"
  if [[ -f "$dest" ]]; then
    if cmp -s "$src" "$dest"; then
      print_kv_row "backup" "$GRAY" "backup_unchanged" "$dest"
      return 0
    fi
    dest="${src}.${full}.bak"
    if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
      print_kv_row "backup" "$GRAY" "backup_unchanged" "$dest"
      return 0
    fi
  fi
  cp "$src" "$dest"
}

run_gen_compliance() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/fromchat-compliance.XXXXXX")"
  "$VENV_PY" scripts/generate_compliance_keypair.py --emit-key-lines </dev/null >"$tmp"
  {
    IFS= read -r _COMPLIANCE_PRIVATE_B64
    IFS= read -r _COMPLIANCE_PUBLIC_B64
  } <"$tmp"
  rm -f "$tmp"
  if [[ -z "$_COMPLIANCE_PRIVATE_B64" || -z "$_COMPLIANCE_PUBLIC_B64" ]]; then
    echo "generate:env: compliance keypair generation failed" >&2
    exit 1
  fi
  print_kv_row "generated " "$LIME" "COMPLIANCE_PUBLIC_KEY" "$_COMPLIANCE_PUBLIC_B64"
  buffer_env_line "COMPLIANCE_PUBLIC_KEY" "$_COMPLIANCE_PUBLIC_B64"
}

_write_compliance_keypair_txt() {
  [[ -n "$_COMPLIANCE_PRIVATE_B64" && -n "$_COMPLIANCE_PUBLIC_B64" ]] || return 0
  [[ -n "$COMPLIANCE_TXT" ]] || return 0
  mkdir -p "$(dirname "$COMPLIANCE_TXT")"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat >"$COMPLIANCE_TXT" <<EOF
COMPLIANCE SYSTEM X25519 KEYPAIR
Generated: ${ts}
================================================================================

PRIVATE KEY (STORE OFFLINE ON AIR-GAPPED MACHINE):
${_COMPLIANCE_PRIVATE_B64}

PUBLIC KEY (SET AS COMPLIANCE_PUBLIC_KEY ENV VAR):
${_COMPLIANCE_PUBLIC_B64}

================================================================================
⚠️  SECURITY WARNING:
    - Keep the PRIVATE KEY offline on an air-gapped machine
    - Only the PUBLIC KEY should be deployed to servers
    - Never commit private key to version control
EOF
}

process_line() {
  local line="$1"
  [[ -z "$line" ]] && return 0
  [[ "$line" =~ ^[[:space:]]*# ]] && return 0
  local key rhs
  key="${line%%=*}"
  rhs="${line#*=}"
  key="${key%"${key##*[![:space:]]}"}"
  key="${key#"${key%%[![:space:]]*}"}"

  case "$rhs" in
    \<set\>)
      prompt_set "$key"
      ;;
    \<gen:compliance\>)
      run_gen_compliance
      ;;
    *)
      if [[ "$rhs" == \<gen:* ]]; then
        echo "Unknown template token for ${key}=${rhs}" >&2
        exit 1
      fi
      print_kv_row "generated " "$LIME" "$key" "$rhs"
      buffer_env_line "$key" "$rhs"
      ;;
  esac
}

read_yes() {
  local prompt="$1"
  local a
  printf '%b%s%b' "$GRAY" "$prompt" "$NC" >&2
  IFS= read -r a || true
  [[ "${a:-}" =~ ^[yY]([eE][sS])?$ ]]
}

# Backups: safe default yes — only explicit n/no skips; Enter, y/yes, or anything else → backup
read_yes_default_yes() {
  local prompt="$1" a
  printf '%b%s%b' "$GRAY" "$prompt" "$NC" >&2
  IFS= read -r a || true
  a="${a#"${a%%[![:space:]]*}"}"
  a="${a%"${a##*[![:space:]]}"}"
  [[ "$a" =~ ^[nN]([oO])?$ ]] && return 1
  return 0
}

# Sets global named by $1 to trimmed read line or default $2; $3 = stderr label.
prompt_output_path() {
  local _out_var="$1" _default="$2" _label="$3" _line
  printf '%b%s%b ' "$GRAY" "$_label" "$NC" >&2
  printf '[%s]: ' "$_default" >&2
  IFS= read -r _line || true
  _line="${_line#"${_line%%[![:space:]]*}"}"
  _line="${_line%"${_line##*[![:space:]]}"}"
  if [[ -z "$_line" ]]; then
    printf -v "$_out_var" '%s' "$_default"
  else
    printf -v "$_out_var" '%s' "$_line"
  fi
}

# --- main: build buffer only ---
exec 3<<< "$_ENV_TEMPLATE"
while IFS= read -r line <&3 || [[ -n "$line" ]]; do
  process_line "$line"
done
exec 3<&-

printf '\n' >&2
if ! read_yes "Write generated files? [y/N]: "; then
  printf '%bAborted (no commit).%b\n' "$RED" "$NC" >&2
  exit 1
fi

prompt_output_path DEPLOY_OUTPUT_DIR "deployment" "Deployment output directory (under repo)"
DEPLOY_OUTPUT_DIR="${DEPLOY_OUTPUT_DIR%/}"
if [[ "$DEPLOY_OUTPUT_DIR" != /* ]]; then
  DEPLOY_OUTPUT_DIR="${ROOT}/${DEPLOY_OUTPUT_DIR}"
fi
ENV_PATH="${DEPLOY_OUTPUT_DIR}/.env"
COMPLIANCE_TXT="${DEPLOY_OUTPUT_DIR}/compliance_keypair.txt"

if [[ -f "$ENV_PATH" ]] && read_yes_default_yes "File exists: ${ENV_PATH}. Create backup before overwrite? [Y/n]: "; then
  _do_backup_copy "$ENV_PATH"
fi

if [[ -f "$COMPLIANCE_TXT" ]] && read_yes_default_yes "File exists: ${COMPLIANCE_TXT}. Create backup before overwrite? [Y/n]: "; then
  _do_backup_copy "$COMPLIANCE_TXT"
fi

mkdir -p "$(dirname "$ENV_PATH")"
printf '%s\n' "${ENV_LINES[@]}" >"$ENV_PATH"
_write_compliance_keypair_txt

printf '\n%b✓ env written to %s%b\n' "$CHECK" "$ENV_PATH" "$NC"
if [[ -n "$_COMPLIANCE_PUBLIC_B64" ]]; then
  printf '%b✓ compliance keypair written to %s%b\n' "$CHECK" "$COMPLIANCE_TXT" "$NC"
fi
