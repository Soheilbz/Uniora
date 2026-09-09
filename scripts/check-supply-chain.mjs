import { readFileSync } from "node:fs";

const failures = [];
const read = (file) => readFileSync(file, "utf8");
const dependabot = read(".github/dependabot.yml");
for (const token of [
  "package-ecosystem: npm",
  "package-ecosystem: github-actions",
  "package-ecosystem: docker",
  "interval: weekly",
]) {
  if (!dependabot.includes(token)) failures.push(`dependabot missing ${token}`);
}

const workflowFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/workflows/supply-chain.yml",
];
for (const file of workflowFiles) {
  const source = read(file);
  for (const match of source.matchAll(/^\s*-\s+uses:\s+([^\s#]+)/gm)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    if (!/^[^@\s]+@[0-9a-f]{40}$/.test(reference)) {
      failures.push(
        `${file} external Action is not pinned to a full immutable commit SHA: ${reference}`,
      );
    }
  }
}

const supply = read(".github/workflows/supply-chain.yml");
for (const token of [
  "dependency-review-action@",
  "sbom-action@",
  "trivy-action@",
  "univ-web:supply-chain",
  "univ-web-tenant-worker:supply-chain",
  "univ-web-platform-worker:supply-chain",
  "univ-web-operations:supply-chain",
  "--target runner",
  "--target tenant-worker",
  "--target platform-worker",
  "--target operations",
  "Trivy tenant-worker image vulnerability scan",
  "Trivy platform-worker image vulnerability scan",
  "Trivy operations image vulnerability scan",
  "permissions:",
  "contents: read",
  "--build-context pnpm-store=",
  "--build-context pnpm-metadata=",
  "Materialize verified offline Docker dependency contexts",
]) {
  if (!supply.includes(token)) failures.push(`supply-chain workflow missing ${token}`);
}
if (/--target\s+worker\b|univ-web-worker:supply-chain/.test(supply)) {
  failures.push("supply-chain workflow still references the retired shared worker target/image");
}

const release = read(".github/workflows/release.yml");
for (const token of [
  "actions/attest-build-provenance@",
  "sigstore/cosign-installer@",
  "cosign sign-blob",
  "id-token: write",
  "attestations: write",
  "sbom.spdx.json",
  "certify-source:",
  "uses: ./.github/workflows/ci.yml",
  "needs: certify-source",
]) {
  if (!release.includes(token))
    failures.push(`release provenance/certification workflow missing ${token}`);
}

const ci = read(".github/workflows/ci.yml");
for (const token of [
  "permissions:",
  "contents: read",
  "performance:",
  "performance:regression",
  "PostgreSQL 18.6 client from pinned service image",
  "MFA old-key rotation drill",
  "Backup old-key, rekey",
  "Background export worker drill",
  "Audit seal chain drill",
  "Compose production schema",
  "Build isolated production runtime images",
  "psql --version",
  "Secret scan",
  "pnpm check:secrets",
  "Production license scan",
  "pnpm check:licenses",
]) {
  if (!ci.includes(token)) failures.push(`CI hardening missing ${token}`);
}

const bootstrap = read("scripts/setup-local.mjs");
for (const token of ["toolchain", "pnpm.mjs", "refusing a registry-based bootstrap retry"]) {
  if (!bootstrap.includes(token))
    failures.push(`bootstrap is missing the vendored pnpm contract: ${token}`);
}
if (bootstrap.includes('"dlx"')) {
  failures.push("setup-local must not re-exec pnpm through the live registry");
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("supply-chain contract ok");
