import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  ".env.example",
  ".env.database.example",
  ".env.database.local.example",
  ".env.operations.example",
  ".env.platform-worker.example",
  ".env.production.example",
  ".env.worker.example",
  "README.md",
  "README.fa.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "SUPPORT.md",
  "docs/architecture.md",
  "docs/linux-deployment.md",
  "docs/release.md",
  "docs/drizzle-migrations.md",
  "test-support/engine-render.tsx",
  "test-support/student-error-keys.ts",
  ".editorconfig",
  ".node-version",
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "toolchain/pnpm/11.21.0/manifest.json",
];
const forbiddenPatterns = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.next-dev(\/|$)/,
  /(^|\/)\.univ(\/|$)/,
  /(^|\/)\.runtime-closures(\/|$)/,
  /(^|\/)\.run-[^/]+(\/|$)/,
  /(^|\/)\.artifacts[^/]*(\/|$)/,
  /(^|\/)\.auth[^/]*(\/|$)/,
  /(^|\/)\.state[^/]*\.json$/,
  /(^|\/)playwright-report(\/|$)/,
  /(^|\/)test-results(\/|$)/,
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(local|production|operations|worker|database)$/,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)(dump|backup)[-_].*\.(sql|dump|bak)$/i,
  /(^|\/)univ-web-.*-source\.zip(?:\.sha256)?$/i,
  /(^|\/)sbom[^/]*\.json$/i,
  /(^|\/).*\.sigstore\.json$/i,
  /(^|\/)\.tmp\/better-auth-schema(\/|$)/i,
  /(^|\/)docs\/r15(\/|$)/i,
  /(^|\/)R15_FINAL_SOURCE_README\.md$/i,
  /(^|\/)docs\/remediation-0\.7\.1\.md$/i,
];

const errors = [];
for (const path of required) {
  try {
    if (!statSync(join(root, path)).isFile())
      errors.push(`required source file is not a file: ${path}`);
  } catch {
    errors.push(`required source file is missing: ${path}`);
  }
}

const localOnlyRoots = new Set([
  ".next",
  ".next-dev",
  ".univ",
  ".runtime-closures",
  "node_modules",
  "releases",
]);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(pkg.version ?? "").trim();
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const rel = relative(root, full).replaceAll("\\", "/");
    /*
     * A checkout is also a runnable development workspace. These root-level
     * directories are either generated runtime state or the deliberately
     * isolated release vault; package-source.mjs copies an explicit source
     * allow-list, so none of them can enter a release archive. Still scan every
     * product/source directory below root so an artifact accidentally committed
     * in src, db, docs, scripts, or e2e remains a hard failure.
     */
    if (entry.isDirectory() && rel.split("/").length === 1 && localOnlyRoots.has(rel)) continue;
    if (rel === ".env.local") continue;
    /* Playwright's per-run evidence is disposable test output, not source.
       Keep failed traces available for debugging without allowing them to
       poison the release-source gate. The runner places them under this
       explicit namespace and never copies it into a release archive. */
    if (entry.isDirectory() && rel.startsWith("e2e/.run-")) continue;
    if (forbiddenPatterns.some((pattern) => pattern.test(rel))) {
      errors.push(`forbidden release artifact: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) walk(full);
  }
}
walk(root);

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  errors.push(`package.json has an invalid version: ${version || "<empty>"}`);
}

for (const rel of [
  "src/components/app-shell.tsx",
  "src/app/sign-in/page.tsx",
  "src/app/(app)/settings/about/page.tsx",
  "src/app/(app)/settings/data/actions.ts",
]) {
  const text = readFileSync(join(root, rel), "utf8");
  const fallback =
    text.match(/NEXT_PUBLIC_APP_VERSION\s*\?\?\s*["']([^"']+)["']/)?.[1] ??
    text.match(/NEXT_PUBLIC_APP_VERSION\s*\|\|\s*["']([^"']+)["']/)?.[1];
  if (fallback && fallback.replace(/^v/, "") !== version) {
    errors.push(`${rel} has app-version fallback ${fallback}; package.json is ${version}`);
  }
}

if (errors.length) {
  console.error(`Source-package integrity check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Source-package integrity check passed for ${version}.`);
