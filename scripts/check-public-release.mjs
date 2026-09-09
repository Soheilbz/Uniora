import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const errors = [];
const required = [
  "README.md",
  "README.fa.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "SUPPORT.md",
  "docs/architecture.md",
  "docs/production.md",
  "docs/linux-deployment.md",
  "docs/release.md",
  "docs/drizzle-migrations.md",
  ".editorconfig",
  ".node-version",
  ".nvmrc",
];
for (const file of required)
  if (!existsSync(join(root, file))) errors.push(`missing public-release file: ${file}`);
for (const legacy of [
  "R15_FINAL_SOURCE_README.md",
  "docs/r15",
  "docs/remediation-0.7.1.md",
  "scripts/r15-windows-prepare.ps1",
  "scripts/r15-final-audit.ps1",
  "src/modules/council/exports.ts",
  "src/modules/professors/export.ts",
  "src/modules/workshops/export.ts",
  "src/lib/security/envelope.ts",
  "scripts/export-worker.mjs",
])
  if (existsSync(join(root, legacy))) errors.push(`legacy/internal artifact remains: ${legacy}`);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.private !== true)
  errors.push("package.json must remain private to prevent accidental npm publication");
if (pkg.license !== "UNLICENSED")
  errors.push("package.json must explicitly declare the proprietary source package as UNLICENSED");
if (!pkg.scripts?.["release:prepare"] || !pkg.scripts?.["release:audit"])
  errors.push("stable release preparation/audit commands are missing");
if (pkg.scripts?.["prepare:r15"] || pkg.scripts?.["audit:r15"])
  errors.push("release-specific R15 script aliases remain");

const seedSource = readFileSync(join(root, "scripts/seed.ts"), "utf8");
if (seedSource.includes("admin-dev-password") || /SEED_ADMIN_PASSWORD\s*\?\?/.test(seedSource))
  errors.push("seed script retains a fallback administrator password");
if (/console\.log\([^\n]*ADMIN_PASSWORD/.test(seedSource))
  errors.push("seed script prints the administrator password");

const version = String(pkg.version || "");
for (const file of [
  "src/components/app-shell.tsx",
  "src/app/sign-in/page.tsx",
  "src/app/(app)/settings/about/page.tsx",
]) {
  const text = readFileSync(join(root, file), "utf8");
  const values = [...text.matchAll(/NEXT_PUBLIC_APP_VERSION\s*\?\?\s*["']v?([^"']+)["']/g)].map(
    (m) => m[1],
  );
  for (const fallback of values)
    if (fallback !== version)
      errors.push(`${file}: app-version fallback ${fallback} != ${version}`);
}

function walk(dir, rel = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (["node_modules", ".next", ".next-dev", ".univ", ".git", "toolchain"].includes(entry.name))
      continue;
    if (entry.isDirectory()) walk(join(dir, entry.name), childRel);
    else if (
      /\.(ts|tsx|js|mjs|md|json|sql|ps1)$/.test(entry.name) &&
      !childRel.startsWith("drizzle/")
    ) {
      const text = readFileSync(join(dir, entry.name), "utf8");
      if (
        /\b(?:TODO|FIXME|HACK|XXX)\b/.test(text) &&
        !["scripts/check-tests.mjs", "scripts/check-public-release.mjs"].includes(childRel)
      )
        errors.push(`${childRel}: unresolved implementation marker`);
    }
  }
}
walk(root);

// pnpm-lock.yaml is a committed release artifact. Detect manifest/importer drift before packaging; release:prepare may refresh it deliberately on the certification host.
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
for (const [name, specifier] of Object.entries({
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
})) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    !new RegExp(
      `['"]?${escaped}['"]?:\\n\\s+specifier: ${String(specifier).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ).test(lock)
  ) {
    errors.push(
      `pnpm-lock.yaml is not reconciled with package.json for ${name}@${specifier}; refresh and review the lockfile before release`,
    );
  }
}

if (errors.length) {
  console.error(`Public-release hygiene check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Public-release hygiene check passed for ${version}.`);
