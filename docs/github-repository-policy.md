# GitHub repository policy

This document is the single record of the repository-level controls that live
in GitHub rather than in the application source. Update it whenever a setting
changes. The repository owner remains the authority for any access, licensing,
or production-credential decision.

## Repository identity and access

- Repository: [`Soheilbz/Uniora`](https://github.com/Soheilbz/Uniora), default
  branch `main`; public for now, with the proprietary [`LICENSE`](../LICENSE).
- Under [GitHub's fork and licensing rules](https://docs.github.com/en/pull-requests/reference/forks),
  users can view and fork a public repository, and public forks remain public.
  Under those Terms, the owner grants users a nonexclusive license to use,
  display, perform, and reproduce the content by forking it through GitHub. The
  proprietary project license does not grant an independent right to use or
  redistribute the software outside GitHub. If new public forks must be
  prevented, the repository must become private; existing copies remain.
  The owner has chosen to keep it public for now.
- `main` is protected for administrators too. Pull requests must be up to date,
  use linear history, resolve conversations, and pass all required checks.
  Force-push and branch deletion are disabled.
- Required checks: static/type/behavioral gates, performance, PostgreSQL
  integration, operations recovery/privilege drills, browser E2E, image
  build/security, dependency review, and CodeQL.
- Only squash merging is enabled. GitHub uses the PR title and body, deletes
  merged head branches, and permits auto-merge once all required checks pass.
- Required approving reviews remain at zero because the repository currently
  has only its owner as an active collaborator; requiring another approval
  would make this owner's PRs impossible to merge. Revisit if a second
  maintainer is added. `.github/CODEOWNERS` identifies the owner for review
  routing, but does not manufacture an independent reviewer.
- Signed commits are not currently required. Enable that gate only after the
  owner has configured a signing key and the candidate history meets the
  policy; the current candidate contains unsigned commits.

## Actions and automation

- Actions are enabled with a selected-action allow-list. GitHub-owned actions
  are allowed, but every action reference must still be pinned to a full
  commit SHA, and the repository enforces SHA pinning. Third-party actions are
  limited to `anchore/sbom-action`, `aquasecurity/trivy-action`, its nested
  `aquasecurity/setup-trivy`, and `sigstore/cosign-installer`; marketplace-wide
  verified-publisher access is off.
- The default `GITHUB_TOKEN` permission is read-only. Workflows request extra
  permissions only for the jobs that need them. First-time contributors need
  approval before workflows from their pull requests run.
- The allow-list must be updated together with any newly introduced direct or
  nested third-party action repository. Existing Dependabot updates keep using
  their allow-listed action repositories.
- Dependabot alerts, security updates, and automatic security fixes are on.
  Weekly updates cover npm, Docker, and GitHub Actions dependencies.

## Security reporting and release controls

- Secret scanning and push protection are enabled. There are no open secret
  scanning alerts at the last audit. Private vulnerability reporting is on;
  reports should be handled under [`SECURITY.md`](../SECURITY.md).
- Generic/non-provider secret patterns are not enabled: GitHub currently makes
  that feature available to organization-owned repositories with GitHub Team
  and Secret Protection, not this personal-account repository
  ([availability](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enabling-secret-scanning-for-generic-patterns)). Automatic
  validity checks are likewise unavailable for this personal-account
  repository under its current plan
  ([availability](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/customize-leak-detection/enable-validity-checks)).
  If the repository later moves to an eligible organization plan, keep those
  checks opt-in because they can contact a secret's issuing provider.
- CodeQL runs through the pinned workflow in `.github/workflows/codeql.yml`;
  the default CodeQL setup is intentionally not configured in parallel.
- Full CI and image/SBOM scanning run as required pull-request gates, not again
  on the resulting `main` merge commit. This avoids re-running the same expensive
  matrix against an unchanged tree. CodeQL still runs on `main` pushes and the
  image supply-chain workflow runs on its weekly schedule; tagged releases reuse
  the full CI workflow before producing release evidence.
- Tagged release creation is separate from PR qualification. No production
  environment, production secret, deployment, or release tag is configured as
  part of this candidate. Set up deployment environments and their protected
  secrets only after the production host/provider choices are made.
- Do not dismiss alerts against `main` merely because a pull request fixes
  them. Verify the candidate's required checks and merge through the protected
  path, then confirm the default branch's alert state.

## GitHub settings

- [Branch protection](https://github.com/Soheilbz/Uniora/settings/branches)
- [Actions permissions](https://github.com/Soheilbz/Uniora/settings/actions)
- [Code security and analysis](https://github.com/Soheilbz/Uniora/settings/security_analysis)
- [Dependabot alerts](https://github.com/Soheilbz/Uniora/security/dependabot)

Last audited: 2026-09-12.
