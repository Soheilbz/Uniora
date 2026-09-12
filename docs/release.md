# Release Process

GitHub-hosted repository controls are documented in the
[GitHub repository policy](github-repository-policy.md). That document is the
canonical record for branch protection, Actions permissions, security settings,
and deployment-environment boundaries.

## Versioning

The application follows semantic versioning while pre-1.0. Patch releases may contain repository hygiene, operational hardening and defect fixes without changing the public domain model.

## Linux release preparation

```bash
pnpm release:prepare
```

This command:

1. refreshes `pnpm-lock.yaml` from `package.json`;
2. rejects any explicit npm-registry tarball without SHA-512 integrity;
3. installs the exact locked graph;
4. generates the official Better Auth plugin schema for reconciliation;
5. reconciles any reviewed manual-migration metadata gap with a verified Drizzle metadata-only custom migration when needed;
6. runs the public-release hygiene gate against the refreshed lockfile.

Review dependency and generated-schema changes before committing them.

Before opening a pull request, run the repository-owned hygiene gates as well:

```bash
pnpm check:secrets
pnpm check:licenses
pnpm check:public-release
```

The secret gate checks high-confidence provider-token/private-key formats in
tracked files and every available Git commit without echoing matched values.
The license gate reads the installed production graph from pnpm and fails on
licenses outside the reviewed allow-list. If pnpm's package-index metadata is
absent in a clean offline archive environment, it uses the installed graph's
package metadata instead, still failing closed when a package or license field
cannot be read. CI runs both gates independently in addition to the complete
`pnpm check` chain.

## Certification

Use a disposable PostgreSQL 18 database/clone:

```bash
pnpm release:audit
```

The audit performs locked installation, auth-schema reconciliation, migration-safety checks, static/type/unit gates, database migration/privilege validation, operational diagnostics, integration tests and E2E unless explicitly skipped.

`typecheck:dependencies` checks the application source against the installed dependency graph with TypeScript's `skipLibCheck` mode. This is intentional: Better Auth, Drizzle and Next publish optional multi-runtime declarations that are not part of this PostgreSQL/Node target and cannot be made a release failure without checking vendor code outside the application boundary. The ordinary `typecheck` gate remains strict for all application and generated route types.

## Source package

```bash
pnpm check:source-package
pnpm source:package
```

The source packager writes a deterministic ZIP with POSIX-style forward-slash entry names and copies only the documented allow-list. Reviewed repository documentation under `docs/` is included, while local state, caches, secrets, disposable test reports and generated runtime artifacts are excluded.

## CI release artifacts

Tagged releases produce the source ZIP, SHA-256 file, SPDX SBOM, Sigstore bundle and GitHub build-provenance attestation.
