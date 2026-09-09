# Contributing

This source tree is maintained as a production application, not a collection of independent scripts.

## Before changing code

1. Preserve the modular-monolith architecture unless an approved architecture decision says otherwise.
2. Preserve PostgreSQL RLS and tenant-scoped transaction boundaries.
3. Put domain business logic in application/domain modules, not route handlers or Server Actions.
4. Do not add Redis, Kafka, Elasticsearch, Kubernetes, generic BPM or Event Sourcing without measured need and an explicit design decision.
5. Do not store permanent attachments in PostgreSQL or local disk.
6. Never introduce a second implementation for an existing rule or workflow when the canonical service can be extended.

## Quality gates

On the supported Linux development/release environment:

```bash
pnpm release:prepare
pnpm check
pnpm test:integration
pnpm e2e
pnpm release:audit
```

Update migration safety metadata, architecture/release documentation and tests when changing database, security, job, integration or official-record contracts.
