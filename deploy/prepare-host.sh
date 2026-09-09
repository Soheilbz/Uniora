#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_ROOT="/etc/univ-web"
DATA_ROOT="${UNIV_DATA_ROOT:-/var/lib/univ-web}"
RUNTIME_UID="${UNIV_RUNTIME_UID:-1000}"
RUNTIME_GID="${UNIV_RUNTIME_GID:-1000}"
SERVICE_PATH="/etc/systemd/system/univ-web-compose.service"
STACK_ENV="$CONFIG_ROOT/stack.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "prepare-host.sh must run as root (use sudo)." >&2
  exit 1
fi
for command_name in docker systemctl install; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required host command: $command_name" >&2; exit 1; }
done
docker compose version >/dev/null
docker buildx version >/dev/null
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable or the current user cannot access its socket; start Docker and refresh group membership." >&2
  exit 1
fi

if [[ "$DATA_ROOT" != /* || "$DATA_ROOT" == *$'\n'* ]]; then
  echo "UNIV_DATA_ROOT must be an absolute single-line Linux path" >&2
  exit 1
fi
if ! [[ "$RUNTIME_UID" =~ ^[0-9]+$ && "$RUNTIME_GID" =~ ^[0-9]+$ ]]; then
  echo "UNIV_RUNTIME_UID and UNIV_RUNTIME_GID must be numeric" >&2
  exit 1
fi
if [[ "$RUNTIME_UID" == "0" || "$RUNTIME_GID" == "0" ]]; then
  echo "UNIV_RUNTIME_UID and UNIV_RUNTIME_GID must be non-zero" >&2
  exit 1
fi

install -d -o root -g root -m 0750 "$CONFIG_ROOT"
install -d -o "$RUNTIME_UID" -g "$RUNTIME_GID" -m 0750 "$DATA_ROOT"
for directory in exports backups audit-seals dr-reports; do
  install -d -o "$RUNTIME_UID" -g "$RUNTIME_GID" -m 0750 "$DATA_ROOT/$directory"
done

install_template() {
  local source="$1" target="$2" label="$3"
  if [[ ! -e "$target" ]]; then
    install -o root -g root -m 0600 "$source" "$target"
    echo "Created $target from the $label template. Replace every placeholder before start."
  fi
  chown root:root "$target"
  chmod 0600 "$target"
}
install_template "$ROOT/.env.production.example" "$CONFIG_ROOT/web.env" "Web production"
install_template "$ROOT/.env.worker.example" "$CONFIG_ROOT/worker.env" "tenant-worker"
install_template "$ROOT/.env.platform-worker.example" "$CONFIG_ROOT/platform-worker.env" "Platform-worker"
install_template "$ROOT/.env.operations.example" "$CONFIG_ROOT/operations.env" "privileged operations"

cat > "$STACK_ENV" <<ENV
UNIV_DATA_ROOT=$DATA_ROOT
UNIV_RUNTIME_UID=$RUNTIME_UID
UNIV_RUNTIME_GID=$RUNTIME_GID
UNIV_WEB_WEB_ENV_FILE=$CONFIG_ROOT/web.env
UNIV_WEB_WORKER_ENV_FILE=$CONFIG_ROOT/worker.env
UNIV_WEB_PLATFORM_WORKER_ENV_FILE=$CONFIG_ROOT/platform-worker.env
UNIV_WEB_OPERATIONS_ENV_FILE=$CONFIG_ROOT/operations.env
ENV
chown root:root "$STACK_ENV"
chmod 0600 "$STACK_ENV"

install -m 0644 "$ROOT/deploy/systemd/univ-web-compose.service" "$SERVICE_PATH"
systemctl daemon-reload

cat <<MSG
Linux host skeleton prepared.

Do NOT start the service yet unless all four environment files contain real production values.
Next:
  1. edit $CONFIG_ROOT/web.env, worker.env, platform-worker.env and operations.env
  2. point /opt/univ-web/current at this reviewed release
  3. run: cd /opt/univ-web/current && sudo ./deploy/linux-stack.sh check
  4. build/pull release images, run db:migrate + db:setup, then ./deploy/linux-stack.sh certify
  5. enable: systemctl enable --now univ-web-compose.service
  6. configure TLS reverse proxy from deploy/nginx/univ-web.conf.example
MSG
