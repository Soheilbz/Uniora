# Support and Operations

Univ Web is operational software with database, worker, object-storage and identity-provider dependencies.

Before escalating an issue, collect only non-sensitive diagnostics:

- application version
- migration/schema version
- health/readiness result
- worker heartbeat/queue status
- PostgreSQL major version
- sanitized error code and correlation/request ID

Do not attach production `.env` files, database dumps, private keys, bearer tokens, MFA seeds, identity-provider secrets or full personal records to support requests.

Operational commands and disaster-recovery procedures are documented in [docs/production.md](docs/production.md).
