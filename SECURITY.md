# Security Policy

## Reporting a vulnerability

Do not open a public issue containing credentials, exploit details, personal data, tenant identifiers, database dumps or reproduction material that could expose a deployment.

For this repository, use GitHub's private vulnerability reporting when it is available:
[Report a vulnerability privately](https://github.com/Soheilbz/Uniora/security/advisories/new).
If that channel is unavailable, use the private security/contact channel designated by the
deployment owner. Include the affected version, component, impact, minimum reproduction steps
and whether the issue crosses tenant, privilege or document boundaries.

## Security boundaries

The following are security invariants, not optional conventions:

- PostgreSQL forced RLS is the tenant data boundary.
- The Web runtime uses a restricted database role and must not receive owner/admin credentials.
- Platform workers and tenant workers have separate execution privileges.
- Public verification routes return deliberately limited data.
- Object storage uses short-lived signed operations; permanent local upload storage is unsupported.
- Service accounts, webhook secrets, MFA material and integration secrets are stored/handled through dedicated secret boundaries.
- Enterprise SSO/SCIM provisioning is fail-closed and must not implicitly map accounts by email.
- Break-glass access is time-limited, MFA-elevated and audited.

## Supported release

Security fixes are expected to target the current release line. Operators should validate database migrations, dependency lockfiles, backup restore, provider integrations and release signatures before production rollout.
