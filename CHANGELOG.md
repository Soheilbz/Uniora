# Changelog

All notable source releases are documented here.

## 0.8.2 — 2026-09-05

### Production engineering consolidation — 2026-09-06

- Completed the second full-stack architecture/UX/operations audit and resolved the tracked 50-item engineering backlog without rewriting historical migrations.
- Split production authority into four code/credential images (Web, tenant worker, Platform worker, one-shot operations) and emit JavaScript-only runtime closures from typed sources before image construction.
- Removed dual `.mjs`/`.d.mts` runtime contracts, Windows-only maintenance surface and the dormant/unwired field-encryption feature.
- Added migration `0045_data_contract_cleanup` for native booleans, durable JSON integrity, worker health and indexed Platform audit/operation projections; reconciled Drizzle schema indexes while preserving all earlier SQL byte-for-byte.
- Replaced Platform Audit OFFSET/full-count navigation with keyset/indexed search, reduced tenant-audit repeated aggregation and consolidated attention projection writes.
- Modularized Job/Platform workers, backup runner, seed tooling, domain use-cases, Platform/Master Data/sign-in/user-directory/import/sidebar UI and the global CSS/print system under maintainability ratchets.
- Added tenant-worker structured health/observability, abortable lazy Global Search, semantic import wizard states, application-locale date formatting and broader loading/error/accessibility boundaries.
- Unified safe CSV serialization, durable export metadata/stable JSON contracts and strict import/template parsing; removed production-dead test helpers and added source reachability enforcement.
- Expanded Chromium/Firefox/WebKit UI coverage while preserving Chromium-only PDF production tests, and strengthened behavioral gates for storage, scanner, backup, worker semantics and emitted runtime closures.
- Pinned the Node/Alpine base image by immutable digest and fixed Supply Chain CI to build/scan all isolated runtime images rather than the retired shared worker target.


### Production hardening follow-up — 2026-09-06

- Unified tenant-worker and Platform-worker startup/preflight validation behind shared fail-closed runtime policies; production workers now enforce the same credential, role, timeout and secret contracts even when a deployment preflight is skipped.
- Added attempt fencing and crash reconciliation to background workers so stale attempts cannot heartbeat or publish over a newer lease; hardened webhook, reminder, document-scan, integration and large-import recovery semantics.
- Reworked object-storage cleanup into durable tenant-scoped reconciliation jobs, including abandoned uploads, promoted document/import objects and cancellation/expiry paths; object keys now reject URL-normalized dot segments.
- Fixed concurrent public-form rate limiting, service-account configured rate-limit resolution and inactive-tenant calendar-token access.
- Corrected Platform-worker CI credentials, Linux runtime UID/GID propagation and host ownership checks; destructive E2E database provisioning is now restricted to explicit `e2e` database names on loopback PostgreSQL targets.
- Centralized backup manifest/catalog validation, archive checksums and atomic pair publication; rekey is copy-on-write, retention fails closed on degraded local/off-site catalogs, and Platform verification uses the same authoritative catalog as DR tooling.
- Added permanent regression gates for deployment contracts, storage lifecycle, `SECURITY DEFINER` PUBLIC revocation and backup-format behavior; extended the maintainability ratchet to operational scripts.
- Moved tenant-worker housekeeping off the 2-second queue poll loop onto bounded maintenance cadences derived from the lease contract, reducing steady-state database churn without weakening stale-lease recovery.
- Centralized strict participant-import profile/mapping validation; corrupt saved profiles remain visible but are non-executable, and small/large import server paths use the same schema.
- Centralized export-artifact metadata validation and recursive stable-JSON canonicalization; fixed semantic export deduplication so request timestamps no longer defeat duplicate suppression.
- Reassigned `job_attempts` retention to the worker-owned ledger authority instead of widening Web-role DELETE privileges, and made the Web export filesystem mount read-only.
- Tightened source-package hygiene so generated source ZIP/checksum artifacts cannot remain inside the source tree between release runs.

### Security

- Reworked browser uploads to use a quarantine namespace and server-side promotion of the exact malware-scanned bytes into a content-addressed final object key, closing the post-scan overwrite TOCTOU window.
- Promoted completed large imports with an ETag-conditional server-side copy into a fresh server-only object key before enqueueing work, closing the mutable-quarantine ABA race.
- Signed and verified upload `Content-Type`, retained object metadata checks, and separated browser-writable and server-only object namespaces.
- Hardened outbound HTTPS against DNS-rebinding/TOCTOU by resolving and validating the destination once and connecting to the approved address while preserving TLS SNI/Host semantics.
- Applied the same pinned-DNS transport to optional HTTP-KMS field encryption; private KMS endpoints require an explicit exact-host allowlist.
- Added bounded timeouts, redirect rejection and response-size limits to object-storage and malware-scanner network operations.
- Corrected field-encryption data-key zeroization to wipe the original allocation.
- Made trusted reverse-proxy handling explicit instead of accepting arbitrary client-supplied forwarding headers.
- Canonicalized user-controlled post-authentication redirect targets to same-origin internal paths and rejected backslash/control/encoded-separator ambiguity.
- Tightened the public SCIM allow-list to the exact `/api/auth/scim/v2` route boundary.

### Identity / database

- Completed the Better Auth 1.7.2 SCIM schema with the seven plugin-owned provisioning models required by the configured static/application-owned SCIM mode.
- Added migration `0037_final_release_hardening` and Drizzle schema declarations for SCIM runtime tables plus a sanitized platform operational-health projection.
- Replaced marker-only Better Auth reconciliation with a machine-verifiable model/field/migration contract.

### Release / operations

- Completed the Linux-first production migration: deterministic portable source packaging, Docker Compose/systemd deployment assets, host preflight, Linux-safe process/tool resolution, and cross-platform release/migration tooling.
- Split production credentials into Web, tenant-worker, Platform-worker, and one-shot operations domains; introduced dedicated `univ_job_worker` and `univ_platform_worker` roles with fail-closed canonical grant policies and production privilege introspection.
- Hardened Web/worker/Platform-worker configuration preflights against credential leakage and added Linux case-sensitive import validation plus worker-runtime closure checks to the release gates.
- Reconciled the pnpm lock graph with Better Auth 1.7.2, Passkey, SCIM, SSO, LDAP and QR-code dependencies; removed all stale Better Auth 1.7.1 references.
- Added a fail-closed release-preparation gate requiring SHA-512 integrity for every explicit npm-registry tarball after lockfile refresh.
- Added explicit production object-storage public/internal endpoint, timeout/read-bound and trusted-proxy contracts; aligned CSP with the configured browser upload origin.
- Moved backup-health reporting to sanitized database metadata so the Web process never needs backup directories or privileged backup credentials.
- Pinned third-party GitHub Actions to immutable commit SHAs and migrated pnpm 11 jobs to `pnpm/setup` with Node 24.18.0.
- Made tagged release packaging depend on full CI certification of the same commit before producing SBOM, signature and provenance artifacts.
- Bumped the public source release to 0.8.2 and documented the deployment/upgrade requirements.

## 0.8.1 — 2026-09-05

### Changed

- Hardened the repository for external/public product distribution.
- Removed obsolete synchronous export modules and duplicate legacy field-encryption abstraction.
- Replaced release-specific preparation/audit command names with stable release commands.
- Consolidated internal implementation/audit documentation into current architecture, release, security and upgrade documentation.
- Added public repository hygiene, support, security and contribution documentation.
- Added explicit Node version files and EditorConfig.
- Aligned application fallback version metadata with the package version.
- Retired the duplicate legacy `export_jobs` queue and dedicated export worker; all exports now use the shared durable job engine.
- Preserved legacy export history through migration `0036_public_release_cleanup` before dropping the retired queue.
- Added a guarded Drizzle generation workflow and metadata-baseline reconciliation so future migration generation cannot silently diff from stale snapshots.
- Removed generated `next-env.d.ts` from source distribution and tightened source-package artifact exclusions.
- Removed the default seed-administrator password, stopped printing seed credentials, and removed a duplicate seed-record invocation.

### Security / operations

- Preserved forced tenant RLS and privilege separation as release invariants.
- Preserved provider-gated enterprise identity and object-storage boundaries.
- Added a release hygiene gate that detects stale lockfile/dependency drift before certification.
- Unified Web-table privileges into a single canonical mutable/append-only/read-only policy consumed by setup, production verification and restore verification.
- Aligned Platform Console table privileges with the same canonical policy instead of contradictory checker-specific special cases.
- Corrected async register exports so allow-listed register filters are preserved in worker-generated artifacts.

## 0.8.0 — 2026-09-05

Architecture/product maturity release adding the application/use-case layer, unified durable jobs, async exports, keyset registers, master data and historical snapshots, document/object-storage workflows, correspondence, tasks, notifications, API/service accounts, transactional outbox, integrations, portals, versioned official rules, data-quality history, operational tooling, advanced register UX, enterprise identity foundations, resumable imports and supply-chain/recovery tooling.

See [docs/upgrades/0.8.0.md](docs/upgrades/0.8.0.md) for database and deployment notes.
