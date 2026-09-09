# Univ Web

A multi-tenant university research-administration platform built with **Next.js**, **PostgreSQL 18**, **Drizzle ORM**, and **forced PostgreSQL row-level security (RLS)**.

> Persian documentation: [README.fa.md](README.fa.md)

## Current release

**0.8.2** — final public-source security and release-integrity hardening release.

The application remains a modular monolith. Tenant isolation is enforced in PostgreSQL; background jobs, platform operations, object storage, official-document workflows, integrations, portals, audit, reporting and administration are built around that boundary.

## Requirements

- Node.js `24.20.0` or newer within the supported 24.x line
- pnpm `11.21.0`
- PostgreSQL 18
- Linux (the only supported development, production, and release-certification target)

`package.json` is the canonical Node.js/pnpm version authority; `.node-version` and `.nvmrc`
mirror the Node pin for version managers, while `pnpm-workspace.yaml` contains repository-local
pnpm store and install policy.

## Local development

On a fresh local checkout, use the idempotent bootstrap path:

```bash
pnpm setup:local
pnpm local:status
```

It creates
the local env files only when they are absent, generates local-only credentials, starts the
project-local PostgreSQL cluster, applies migrations, provisions runtime roles, creates a verified
initial backup, and starts the complete local stack: Web, tenant worker, Platform worker, an
isolated loopback S3-compatible object store, and the development scanner. The supervisor restarts
a child that exits unexpectedly. It requires a complete PostgreSQL 18 toolchain, either project-local
under `.univ/toolchain/postgres` or discoverable through `pg_config --bindir`; use
`pnpm setup:local --no-dev` when only database preparation is needed.
The local bootstrap also creates an `operator` Platform account. On first creation or an explicit
local reset, it writes the credential to `.univ/runtime/platform-operator-credentials.txt` with
owner-only permissions instead of printing the password into terminal or CI logs; read that file
locally and change the credential before sharing the environment. Re-running the bootstrap
preserves an existing operator credential and active sessions; an explicit local reset requires
`PLATFORM_OPERATOR_RESET=1 pnpm platform:user -- operator '<new-password>'`.
Each bootstrap also re-applies private `0700` permissions to local runtime/export/backup
directories and `0600` permissions to generated environment files, repairing permission drift.
It uses the complete project-local PostgreSQL toolchain when present, or a PostgreSQL 18
installation discovered through `pg_config --bindir`; an incompatible or incomplete toolchain
fails early with an actionable message.
To stop or inspect the managed local stack, use `pnpm local:stop` and `pnpm local:status`; do not
start a second `pnpm dev` process while `pnpm local:up` is serving the browser. If a terminal is
interrupted, run `pnpm local:status` and then `pnpm local:stop` before starting again.

For a managed PostgreSQL service, create and configure both local env files first, then run
`pnpm setup:local --external-db --no-dev`; this skips local database lifecycle commands without
changing the configured credentials or host. The command refuses mismatched host/port/database/
TLS targets before migrations, so it cannot silently create a split-brain local setup.

The browser is available at `http://127.0.0.1:3020/sign-in`, and the Platform operator console at
`http://127.0.0.1:3020/platform/sign-in`. Health endpoints are `/api/healthz` and `/api/readyz`.
The local object store and scanner are development-only adapters; they are never used by the
production Compose profile.

If PostgreSQL is externally managed, configure `DATABASE_ADMIN_URL`, `APP_DB_PASSWORD`, `WORKER_DB_PASSWORD`, the restricted `DATABASE_URL`, and the dedicated `DATABASE_WORKER_URL`; do not run `db:start` or `db:stop`.
Local bootstrap validates that the owner, Web, tenant-worker and platform-worker URLs all name the same PostgreSQL host, port, database and TLS mode before it runs the first migration; a mismatch is refused as split-brain.

The Web process uses only `univ_app_web` (forced RLS). Tenant background jobs use `univ_job_worker`, whose `BYPASSRLS` authority is constrained by a three-table allow-list and is never used for domain data. Database-owner credentials belong exclusively to profile-gated one-shot migration/setup/restore operations. Production Linux uses four separate credential domains: Web, tenant worker, long-running Platform worker, and one-shot operations. The Platform worker is privileged but is not the owner and receives only the reviewed subset of maintenance secrets.

## Release preparation

The bundled `pnpm-lock.yaml` is the reviewed 0.8.2 dependency-graph baseline. Final release certification should refresh it with the pinned pnpm on Linux or another supported host. `release:prepare` then rejects any explicit npm-registry tarball that lacks SHA-512 integrity; never insert fabricated SRI values. When dependencies or Better Auth plugin configuration change, refresh the lockfile and reconcile the official plugin schema before committing:

```bash
pnpm release:prepare
```

For every release candidate, run the full certification against a disposable PostgreSQL 18 environment:

```bash
pnpm release:audit
```

For deployment and release certification, see [docs/linux-deployment.md](docs/linux-deployment.md).

## Main commands

```text
pnpm dev                  Start development Web process
pnpm local:up             Start the complete local stack with self-healing workers
pnpm local:stop           Stop the managed local stack
pnpm local:status         Show local stack process state
pnpm build                Build the production application
pnpm check                Static/type/unit quality gates
pnpm test:integration     Integration suite
pnpm e2e                  Production-build Playwright suite
pnpm db:migrate           Apply migrations and refresh existing runtime-role policies
pnpm db:setup             Bootstrap/repair Web + tenant-worker + Platform-worker database roles
pnpm job:worker           Run tenant background jobs
pnpm platform:worker      Run privileged platform operations
pnpm production:check     Validate Web production configuration
pnpm production:worker-check Validate tenant-worker production configuration
pnpm production:db-check Validate Web/tenant-worker/Platform-worker PostgreSQL privilege contracts
pnpm source:package       Create a deterministic portable source ZIP
```

The managed local Web process keeps its Turbopack cache in `.next-dev`, while
release builds use `.next`. This separation is intentional: `pnpm build` can
run while `pnpm local:up` is serving the browser without two Next processes
writing the same development cache.
The local supervisor also holds an atomic start lock, rejects a second supervisor
for this checkout, reclaims only known Uniora development-service orphans, and
forwards stop signals through the worker adapters. If a terminal is interrupted,
run `pnpm local:status` followed by `pnpm local:stop` before starting again; no
database or unrelated service is inferred from a port alone.
`db:start` also refuses to silently move a configured PostgreSQL endpoint to a
different port: use `--external-db` for an intentionally managed PostgreSQL
service or resolve the port conflict first, so bootstrap can never create a
second local database behind the application's existing profile.

## Repository layout

- `src/app` — Next.js routes and route boundaries
- `src/modules` — domain/application/query modules
- `src/components` — shared UI and interaction engines
- `src/db` — schema, RLS-aware database boundaries and tenant transactions
- `drizzle` — immutable migration history and metadata
- `db/sql` — SQL policies/functions not represented cleanly by Drizzle
- `scripts` — release, migration, worker, backup, audit and operational tooling
- `e2e` — Playwright provisioning and test scenarios
- `docs` — architecture, production, security and upgrade documentation

## Architecture and security

Read:

- [Architecture](docs/architecture.md)
- [Production runbook](docs/production.md)
- [Linux deployment](docs/linux-deployment.md)
- [Security policy](SECURITY.md)
- [Release process](docs/release.md)
- [Drizzle migration workflow](docs/drizzle-migrations.md)

Core invariants:

1. Tenant-owned data is protected with forced PostgreSQL RLS.
2. Tenant context is transaction-local; connection pooling must not carry tenant state across requests.
3. Platform/admin credentials are not request-path credentials.
4. Files are stored via object storage, not permanent local uploads or PostgreSQL BLOBs.
5. Official records are versioned/finalized rather than overwritten.
6. Sensitive external integrations are fail-closed and explicitly provisioned.
7. Durable jobs re-check authoritative requester state and capabilities when applicable.

## Source distribution

This repository is marked `private` and `UNLICENSED` in `package.json` to prevent accidental publication to the npm registry. Distribution rights are controlled by the project owner; no open-source license is implied by possession of the source archive.

See [SUPPORT.md](SUPPORT.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before maintaining or redistributing a deployment.

- [Supply-chain policy](docs/supply-chain-policy.md)
