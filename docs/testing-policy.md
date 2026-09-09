# Testing policy

The release gate is risk-based rather than a single vanity coverage number.

- Security/policy parsers, cursor/serialization code, state-machine helpers, and durable artifact schemas require direct unit tests for success and invalid-input paths.
- Worker lease/reconciliation, storage lifecycle, database privilege boundaries, and migration/RLS behavior require PostgreSQL integration or executable source-contract tests until the integration environment is available.
- User-critical journeys run in Playwright against Chromium, Firefox, and WebKit: authentication, shell/navigation, portal/public surfaces, imports, destructive flows, download/print, and platform operations.
- Accessibility automation covers unauthenticated, tenant, portal, and platform surfaces. New interactive components must add keyboard/focus coverage as well as axe coverage.
- Print/CSS refactors require screenshot or PDF golden comparisons for representative worksheets and council output before release.

A changed critical module without a colocated behavioral test is a release-review finding even when repository-wide line coverage is high.
