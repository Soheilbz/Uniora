# Linux deployment

The canonical production target is a Linux host running Docker Engine with the Compose plugin. PostgreSQL is a managed or separately operated PostgreSQL 18 service; the application stack never publishes a database port. The host does not need Node.js or pnpm for normal operation: application runtimes and PostgreSQL client tooling live inside the reviewed images.

The deployment is deliberately split into four credential domains:

- `web`: request-serving Next.js process with the forced-RLS `univ_app_web` role.
- `job-worker`: tenant background jobs with `univ_job_worker`. This role has `BYPASSRLS` only to claim cross-tenant queue rows, but database grants are restricted to `SELECT/UPDATE jobs`, `SELECT/INSERT/UPDATE/DELETE job_attempts`, and `INSERT platform_audit_log`; worker-health updates are exposed only through a constrained `SECURITY DEFINER` function rather than direct table DML. All domain data still uses the Web/RLS connection.
- `platform-worker`: long-running privileged queue worker using the dedicated `univ_platform_worker` database role. The role has `BYPASSRLS` for reviewed cross-tenant work, full read for backup/safety checks, and DML only on an explicit lifecycle/auth/platform allow-list; it is not the database owner and cannot perform DDL or role administration. The process also receives the Web connection only for code paths that intentionally preserve the ordinary RLS boundary, plus the Better Auth/platform-operation and backup secrets required by supported queue actions. It deliberately does **not** receive database-owner credentials, role-provisioning passwords, MFA rotation keys, audit-seal keys, restore opt-ins or tenant-worker secrets.
- `operations`: one-shot maintenance environment for migration/setup, restore, MFA rotation, audit sealing and other operator-run commands. In Compose this service is behind the `tools` profile and is never started by the normal application stack.

## Host layout

Use immutable release directories and an atomic `current` symlink:

- releases: `/opt/univ-web/releases/<release-id>`
- active release: `/opt/univ-web/current -> /opt/univ-web/releases/<release-id>`
- Web environment: `/etc/univ-web/web.env` (`0600`, root-owned)
- tenant-worker environment: `/etc/univ-web/worker.env` (`0600`, root-owned)
- Platform-worker environment: `/etc/univ-web/platform-worker.env` (`0600`, root-owned)
- privileged one-shot operations environment: `/etc/univ-web/operations.env` (`0600`, root-owned)
- systemd/Compose path settings: `/etc/univ-web/stack.env` (`0600`, root-owned)
- runtime data: `/var/lib/univ-web/{exports,backups,audit-seals,dr-reports}` (owned by the configured container runtime UID/GID, defaults `1000:1000`)

`web.env` must never contain owner/worker-role credentials or backup keys. `worker.env` must never contain database-owner, Better Auth, MFA, platform-operation, backup or audit-seal secrets. `platform-worker.env` is a strict subset of the full operations credential set. Only `operations.env` may contain role-provisioning passwords and destructive-maintenance credentials.
DR rehearsal records are persisted under `/var/lib/univ-web/dr-reports`; the operations container remains read-only everywhere else.

## First installation

Copy the reviewed release into a versioned directory, then activate it:

```bash
sudo install -d -m 0755 /opt/univ-web/releases
sudo cp -a ./univ-web-0.8.2 /opt/univ-web/releases/0.8.2
sudo ln -sfn /opt/univ-web/releases/0.8.2 /opt/univ-web/current
cd /opt/univ-web/current
sudo ./deploy/prepare-host.sh
sudoedit /etc/univ-web/web.env
sudoedit /etc/univ-web/worker.env
sudoedit /etc/univ-web/platform-worker.env
sudoedit /etc/univ-web/operations.env
sudo ./deploy/linux-stack.sh check
sudo ./deploy/linux-stack.sh build
```

Before running `prepare-host.sh`, the host must have Docker Engine, the Compose
plugin and Buildx installed, and the Docker daemon must be running. Verify the
same execution identity that will run the deployment can reach the daemon:

```bash
docker --version
docker compose version
docker buildx version
docker info
```

If Docker was installed for the first time, enable it with the host's service
manager and start a new login session after adding the deployer to the
`docker` group. Membership in that group is effectively privileged, so keep
it limited to trusted administrators. `prepare-host.sh` and the host preflight
now fail early when the daemon or Buildx is unavailable; they never silently
fall back to a local or development container runtime.

`prepare-host.sh` writes both `UNIV_RUNTIME_UID` and `UNIV_RUNTIME_GID` into `/etc/univ-web/stack.env`, creates the data directories with that exact ownership and installs the systemd unit. UID/GID `0` are rejected; Compose runs all long-lived services with the same configured identity so a custom host ownership cannot drift from the container identity. `linux-stack.sh check` validates file ownership/permissions, rejects symlinked secret files and template placeholders, validates data-directory ownership and runs `docker compose config`.

The operations file must contain all three runtime-role provisioning passwords (`APP_DB_PASSWORD`, `WORKER_DB_PASSWORD`, and `PLATFORM_DB_PASSWORD`) in addition to `DATABASE_ADMIN_URL`. `DATABASE_URL`, `DATABASE_WORKER_URL`, and `DATABASE_PLATFORM_URL` must use their corresponding distinct canonical roles.

## Database release step

Run schema migration and role setup explicitly through the profile-gated one-shot `operations` container. They are never hidden in container startup or systemd boot:

```bash
docker compose -f deploy/compose.production.yml --profile tools run --rm operations \
  node scripts/db.mjs migrate

docker compose -f deploy/compose.production.yml --profile tools run --rm operations \
  node scripts/db.mjs setup
```

`db:migrate` is safe on a completely fresh database even if runtime roles do not exist yet; it applies schema and policies, skips absent role grants, and `db:setup` then creates/rotates all three runtime roles and applies their canonical allow-lists. On an existing database, migration refreshes the grants of roles that already exist.

Before cutover, certify the exact injected runtime environments and database privileges:

```bash
sudo ./deploy/linux-stack.sh certify
```

This executes the Web, tenant-worker and Platform-worker configuration preflights, then performs a live database privilege/RLS introspection for all three runtime database roles through the one-shot operations container. Any unexpected table/function/sequence/schema privilege is a hard failure.

## Start and health verification

```bash
sudo ./deploy/linux-stack.sh up
curl --fail http://127.0.0.1:3000/api/healthz
curl --fail http://127.0.0.1:3000/api/readyz
```

`linux-stack.sh up` uses Compose `--wait`; the Web image has a healthcheck and startup fails if the stack does not become ready/running within the configured timeout. Expose only the reverse proxy, normally ports 80/443. Compose binds the application itself to loopback by default. Configure TLS from `deploy/nginx/univ-web.conf.example` or an equivalent reviewed reverse proxy.

## Boot integration

`prepare-host.sh` installs the supplied unit. After certification:

```bash
sudo systemctl enable --now univ-web-compose.service
sudo systemctl status univ-web-compose.service
```

The unit reads `/etc/univ-web/stack.env`, runs the dependency-free Bash host preflight and Compose schema validation, and starts only already-built images. It deliberately does not install packages, build images, run migrations, rotate credentials, or restore backups during boot.

## Update sequence

1. Create and verify a fresh encrypted backup and its off-host copy.
2. Copy the reviewed source into a new `/opt/univ-web/releases/<release-id>` directory.
3. Run the release certification pipeline on that exact source revision.
4. Build the four isolated production images (Web, tenant worker, Platform worker and operations) and validate Compose.
5. Run migration and `db:setup` explicitly through the profile-gated operations service.
6. Run `linux-stack.sh certify` against the production environment.
7. Atomically point `/opt/univ-web/current` to the new release and start/recreate the stack.
8. Verify `/api/healthz`, `/api/readyz`, logs, one authenticated flow, one tenant job, and one operator-health action.
9. Keep the prior release directory/image until the post-deploy verification window is complete.

Schema rollback is forward-only. Never auto-reverse an already-applied migration. Application rollback is allowed only when the previous image is known to remain compatible with the current schema.
