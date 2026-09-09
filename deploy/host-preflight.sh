#!/usr/bin/env bash
set -Eeuo pipefail

DATA_ROOT="${UNIV_DATA_ROOT:-/var/lib/univ-web}"
WEB_ENV="${UNIV_WEB_WEB_ENV_FILE:-/etc/univ-web/web.env}"
WORKER_ENV="${UNIV_WEB_WORKER_ENV_FILE:-/etc/univ-web/worker.env}"
PLATFORM_WORKER_ENV="${UNIV_WEB_PLATFORM_WORKER_ENV_FILE:-/etc/univ-web/platform-worker.env}"
OPS_ENV="${UNIV_WEB_OPERATIONS_ENV_FILE:-/etc/univ-web/operations.env}"
RUNTIME_UID="${UNIV_RUNTIME_UID:-1000}"
RUNTIME_GID="${UNIV_RUNTIME_GID:-1000}"
failures=()

command -v docker >/dev/null 2>&1 || failures+=("docker command is unavailable")
if command -v docker >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  failures+=("docker compose plugin is unavailable")
fi
if command -v docker >/dev/null 2>&1 && ! docker buildx version >/dev/null 2>&1; then
  failures+=("docker buildx plugin is unavailable")
fi
if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  failures+=("docker daemon is unavailable or the current user cannot access its socket; start Docker and refresh group membership")
fi
command -v stat >/dev/null 2>&1 || failures+=("stat command is unavailable")

check_secret_file() {
  local file="$1"
  if [[ ! -e "$file" ]]; then failures+=("missing $file"); return; fi
  if [[ -L "$file" ]]; then failures+=("$file must not be a symbolic link"); return; fi
  if [[ ! -f "$file" ]]; then failures+=("$file must be a regular file"); return; fi
  local mode uid gid perms
  mode="$(stat -c '%a' "$file" 2>/dev/null || true)"
  uid="$(stat -c '%u' "$file" 2>/dev/null || true)"
  if [[ -z "$mode" || -z "$uid" ]]; then failures+=("unable to inspect $file metadata"); return; fi
  perms=$((8#$mode))
  if (( (perms & 077) != 0 )); then failures+=("$file permissions are too broad ($mode); require 0600-style secrecy"); fi
  if [[ "$uid" != "0" ]]; then failures+=("$file must be owned by root (uid 0), found uid $uid"); fi
  if grep -Eqi 'replace-me|replace-with-|example\.com|example\.internal|0123456789abcdef0123456789abcdef' "$file"; then
    failures+=("$file still contains template placeholder values")
  fi
}

check_data_dir() {
  local dir="$1"
  if [[ ! -e "$dir" ]]; then failures+=("missing data directory $dir"); return; fi
  if [[ -L "$dir" ]]; then failures+=("$dir must not be a symbolic link"); return; fi
  if [[ ! -d "$dir" ]]; then failures+=("$dir must be a directory"); return; fi
  local mode uid gid perms
  mode="$(stat -c '%a' "$dir" 2>/dev/null || true)"
  uid="$(stat -c '%u' "$dir" 2>/dev/null || true)"
  gid="$(stat -c '%g' "$dir" 2>/dev/null || true)"
  if [[ -z "$mode" || -z "$uid" || -z "$gid" ]]; then failures+=("unable to inspect $dir metadata"); return; fi
  perms=$((8#$mode))
  if (( (perms & 022) != 0 )); then failures+=("$dir must not be group/world writable (mode $mode)"); fi
  if [[ "$uid" != "$RUNTIME_UID" ]]; then failures+=("$dir must be owned by runtime uid $RUNTIME_UID, found uid $uid"); fi
  if [[ "$gid" != "$RUNTIME_GID" ]]; then failures+=("$dir must be owned by runtime gid $RUNTIME_GID, found gid $gid"); fi
}

if ! [[ "$RUNTIME_UID" =~ ^[0-9]+$ && "$RUNTIME_GID" =~ ^[0-9]+$ ]]; then failures+=("UNIV_RUNTIME_UID and UNIV_RUNTIME_GID must be numeric"); fi
if [[ "$RUNTIME_UID" == "0" || "$RUNTIME_GID" == "0" ]]; then failures+=("UNIV_RUNTIME_UID and UNIV_RUNTIME_GID must be non-zero"); fi
for file in "$WEB_ENV" "$WORKER_ENV" "$PLATFORM_WORKER_ENV" "$OPS_ENV"; do check_secret_file "$file"; done
for dir in "$DATA_ROOT" "$DATA_ROOT/exports" "$DATA_ROOT/backups" "$DATA_ROOT/audit-seals" "$DATA_ROOT/dr-reports"; do check_data_dir "$dir"; done

if ((${#failures[@]})); then
  printf 'Linux host preflight failed (%d issues):\n' "${#failures[@]}" >&2
  printf ' - %s\n' "${failures[@]}" >&2
  exit 1
fi
printf 'Linux host preflight passed.\n'
