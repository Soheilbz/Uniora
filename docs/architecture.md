# Architecture

## Style

Univ Web is a **multi-tenant modular monolith**. Next.js provides Web/UI/API surfaces; application modules own use-cases; PostgreSQL 18 owns durable relational state and the tenant isolation boundary.

```text
Web / UI / API
      │
Application use-cases
      │
Domain modules ── Durable jobs / events / projections
      │
PostgreSQL + forced RLS
      │
Object storage / external adapters
```

## Module boundaries

Primary domains include students, professors, council, workshops, capacity, reports, settings, platform operations, search, calendar, worksheets, tasks, correspondence, documents, research projects, notifications, portals and integrations.

Routes and Server Actions should validate transport/authentication, call an application use-case, map the result and revalidate the UI. They should not become alternate business-logic implementations.

## Tenant model

Tenant-owned queries run through tenant-scoped transaction helpers. Tenant state is transaction-local (`set_config(..., true)`), which is compatible with transaction-mode pooling. The restricted Web role remains subject to forced RLS.

Privileged platform operations are isolated from normal request-path credentials.

## Background processing

A common durable job lifecycle provides scheduling, deduplication, lease/heartbeat, attempt fencing, retries, attempts, failure records and result metadata. Execution privilege is separated by job class: a shared lifecycle does not imply shared authority.

Production code boundaries mirror credential boundaries. The tenant-worker, Platform-worker and one-shot operations images are built from separate transitive runtime closures. TypeScript remains the source of truth, while production worker closures are emitted as JavaScript before image construction; long-running containers do not execute TypeScript source or carry unrelated migration/restore code.

Tenant-worker liveness and counters are persisted through a constrained namespaced health function and surfaced in Platform diagnostics without granting the worker direct cross-domain health-table DML.

Transactional outbox events are inserted with domain mutations and dispatched by system-owned durable jobs.

## Official data

Canonical master-data identifiers coexist with historical snapshots. Published rule/template versions and finalized documents are immutable; corrections create later revisions rather than mutating historical truth.

## Files

Binary documents live in object storage. PostgreSQL stores metadata, hashes, versions, classification and lifecycle state. Uploads pass through quarantine/validation/scanning before becoming available.

## Search and reporting

PostgreSQL projections/read models support global search, attention and analytics without introducing an external search engine or data warehouse by default.
