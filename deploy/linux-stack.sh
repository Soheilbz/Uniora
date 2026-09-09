#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/compose.production.yml"
DATA_ROOT="${UNIV_DATA_ROOT:-/var/lib/univ-web}"
WEB_ENV="${UNIV_WEB_WEB_ENV_FILE:-/etc/univ-web/web.env}"
WORKER_ENV="${UNIV_WEB_WORKER_ENV_FILE:-/etc/univ-web/worker.env}"
PLATFORM_WORKER_ENV="${UNIV_WEB_PLATFORM_WORKER_ENV_FILE:-/etc/univ-web/platform-worker.env}"
OPS_ENV="${UNIV_WEB_OPERATIONS_ENV_FILE:-/etc/univ-web/operations.env}"
RUNTIME_UID="${UNIV_RUNTIME_UID:-1000}"
RUNTIME_GID="${UNIV_RUNTIME_GID:-1000}"
ACTION="${1:-status}"

if ! [[ "$RUNTIME_UID" =~ ^[0-9]+$ && "$RUNTIME_GID" =~ ^[0-9]+$ ]]; then
  echo "UNIV_RUNTIME_UID and UNIV_RUNTIME_GID must be numeric" >&2
  exit 1
fi
if [[ "$RUNTIME_UID" == "0" || "$RUNTIME_GID" == "0" ]]; then
  echo "UNIV_RUNTIME_UID and UNIV_RUNTIME_GID must be non-zero" >&2
  exit 1
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

need docker
docker compose version >/dev/null

case "$ACTION" in
  prepare)
    if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
      echo "prepare must run as root because it creates protected config/data paths" >&2
      exit 1
    fi
    for env_path in "$WEB_ENV" "$WORKER_ENV" "$PLATFORM_WORKER_ENV" "$OPS_ENV"; do
      install -d -m 0750 "$(dirname -- "$env_path")"
    done
    install -d -o "$RUNTIME_UID" -g "$RUNTIME_GID" -m 0750 \
      "$DATA_ROOT" "$DATA_ROOT/exports" "$DATA_ROOT/backups" "$DATA_ROOT/audit-seals" "$DATA_ROOT/dr-reports"
    if [[ ! -e "$WEB_ENV" ]]; then
      install -o root -g root -m 0600 "$ROOT/.env.production.example" "$WEB_ENV"
      echo "created template: $WEB_ENV"
    fi
    if [[ ! -e "$WORKER_ENV" ]]; then
      install -o root -g root -m 0600 "$ROOT/.env.worker.example" "$WORKER_ENV"
      echo "created template: $WORKER_ENV"
    fi
    if [[ ! -e "$PLATFORM_WORKER_ENV" ]]; then
      install -o root -g root -m 0600 "$ROOT/.env.platform-worker.example" "$PLATFORM_WORKER_ENV"
      echo "created template: $PLATFORM_WORKER_ENV"
    fi
    if [[ ! -e "$OPS_ENV" ]]; then
      install -o root -g root -m 0600 "$ROOT/.env.operations.example" "$OPS_ENV"
      echo "created template: $OPS_ENV"
    fi
    chmod 0600 "$WEB_ENV" "$WORKER_ENV" "$PLATFORM_WORKER_ENV" "$OPS_ENV"
    echo "Edit all four env files and replace every placeholder before build/up."
    ;;
  check)
    UNIV_DATA_ROOT="$DATA_ROOT" \
    UNIV_RUNTIME_UID="$RUNTIME_UID" \
    UNIV_RUNTIME_GID="$RUNTIME_GID" \
    UNIV_WEB_WEB_ENV_FILE="$WEB_ENV" \
    UNIV_WEB_WORKER_ENV_FILE="$WORKER_ENV" \
    UNIV_WEB_PLATFORM_WORKER_ENV_FILE="$PLATFORM_WORKER_ENV" \
    UNIV_WEB_OPERATIONS_ENV_FILE="$OPS_ENV" \
      "$ROOT/deploy/host-preflight.sh"
    compose config --quiet
    echo "compose/env/host preflight passed"
    ;;
  build)
    "$0" check
    compose build --pull
    ;;
  certify)
    "$0" check
    compose run --rm --no-deps web node scripts/production-check.mjs --strict
    compose run --rm --no-deps job-worker node scripts/worker-production-check.mjs
    compose run --rm --no-deps platform-worker node scripts/platform-worker-production-check.mjs
    compose --profile tools run --rm --no-deps operations node scripts/production-db-check.mjs
    echo "runtime configuration and database-role certification passed"
    ;;
  up)
    "$0" check
    compose up -d --remove-orphans --wait --wait-timeout 120
    compose ps
    ;;
  down)
    compose down
    ;;
  restart)
    "$0" check
    compose up -d --remove-orphans --force-recreate --wait --wait-timeout 120
    compose ps
    ;;
  status)
    compose ps
    ;;
  logs)
    shift || true
    compose logs --tail=200 -f "$@"
    ;;
  *)
    echo "usage: $0 {prepare|check|build|certify|up|down|restart|status|logs [service]}" >&2
    exit 2
    ;;
esac
