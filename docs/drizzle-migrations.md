# Drizzle migration workflow

The SQL migration history contains deliberately hand-authored migrations for PostgreSQL capabilities that are not represented safely by schema generation alone. Drizzle Kit generates future diffs from its latest JSON snapshot, so **deployment metadata** and **future migration-generation metadata** are treated as separate contracts.

## Deployment metadata contract

`pnpm check:drizzle-baseline` verifies one of two safe states:

1. the latest journal entry has a generated Drizzle snapshot whose table set matches the current `pgTable` schema; or
2. reviewed hand-authored migrations are newer than the last generated snapshot and `drizzle/meta/manual-baseline.json` cryptographically binds the exact migration SQL files and current schema sources through the latest journal entry.

The second state is deployable: runtime migration execution uses the immutable SQL journal, not the Drizzle JSON snapshot. It is **not** generation-ready. The manual baseline is intentionally only an integrity manifest and is never presented to Drizzle Kit as a generated snapshot.

## Release/bootstrap reconciliation

On the certification host run:

```bash
pnpm release:prepare
```

When the journal is newer than the latest generated snapshot, the preparation workflow uses Drizzle Kit's official custom-migration mode to append an **empty metadata baseline** and a real current schema snapshot. The script fails if the generated migration contains DDL/DML or if the generated snapshot does not match the current `pgTable` declarations. After success it removes `manual-baseline.json`.

Review and commit the generated empty migration, snapshot, journal/safety metadata changes, and removal of the manual integrity manifest before generating any later schema migration.

## Future schema changes

Do not invoke `drizzle-kit generate` directly. Use:

```bash
pnpm db:generate -- -Name descriptive_change
```

The wrapper runs the stricter generation-ready gate (`pnpm check:drizzle-generation`) and refuses to generate a migration while the real Drizzle snapshot is behind the journal.

Hand-authored SQL migrations remain appropriate when a change depends on PostgreSQL-specific policy/function/backfill semantics. Always add migration-safety metadata and preserve the immutable migration history.
