# Supply-chain and base-image policy

Production container builds use a Docker Official Node image pinned by immutable multi-platform index digest. Updating the Node/Alpine tag requires reviewing and updating the digest in the same change.

Alpine packages installed with `apk add --no-cache` are intentionally resolved from the repositories embedded in the pinned Alpine base image rather than hard-pinned to package release strings. This keeps security fixes available during an intentional base-image refresh while the immutable base digest, generated SBOM, dependency review, Trivy scan, and release provenance provide the auditable boundary. A release must never silently rebuild from a floating Node tag.

The supported release platform is Linux. Runtime images are separated by authority: Web, tenant worker, platform worker, and one-shot operations. Long-running workers must not carry migration/restore code outside their runtime closure.
