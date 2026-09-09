# Supply-chain and base-image policy

Production container builds use a Docker Official Node image pinned by immutable multi-platform index digest. Updating the Node/Alpine tag requires reviewing and updating the digest in the same change.

Use `pnpm docker:build` for local or persistent-runner image qualification. It uses the
verified offline pnpm contexts, adds the repository ownership labels, protects the
versioned production image references, removes only known Univ Web qualification tags,
and bounds the selected BuildKit builder cache to 32 GB. `pnpm docker:cleanup` is a dry
run by default; `pnpm docker:cleanup --apply` applies the same allowlisted image cleanup
and cache bound. Do not replace this with a broad `docker system prune`, because the
host may contain unrelated projects or rollback images. The deployment Compose path
uses `--no-build`, so production hosts consume pre-qualified images rather than
accumulating build cache during boot.

Alpine packages installed with `apk add --no-cache` are intentionally resolved from the repositories embedded in the pinned Alpine base image rather than hard-pinned to package release strings. This keeps security fixes available during an intentional base-image refresh while the immutable base digest, generated SBOM, dependency review, Trivy scan, and release provenance provide the auditable boundary. A release must never silently rebuild from a floating Node tag.

The supported release platform is Linux. Runtime images are separated by authority: Web, tenant worker, platform worker, and one-shot operations. Long-running workers must not carry migration/restore code outside their runtime closure.
