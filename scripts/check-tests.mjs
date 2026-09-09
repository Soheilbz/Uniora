import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const issues = [];

function filesUnder(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function rel(path) {
  return relative(root, path).split(sep).join("/");
}

const e2eDir = join(root, "e2e");
const specs = filesUnder(e2eDir).filter((path) => path.endsWith(".spec.ts"));
const e2eCorpus = specs.map((path) => readFileSync(path, "utf8")).join("\n");

for (const path of specs) {
  const text = readFileSync(path, "utf8");
  const name = rel(path);
  if (/from\s+["']@playwright\/test["']/.test(text)) {
    issues.push(`${name}: imports raw @playwright/test instead of support/fixtures`);
  }
  if (/\btest\.(?:skip|only|fixme|todo)\s*\(/.test(text)) {
    issues.push(`${name}: contains a skip/only/fixme/todo release test`);
  }
  if (/browser\.newContext\s*\(/.test(text)) {
    issues.push(`${name}: creates an unobserved raw BrowserContext`);
  }
  if (/if\s*\([^\n]*\.count\(\)[^\n]*\)\s*\{/.test(text)) {
    issues.push(`${name}: conditionally omits coverage based on locator count`);
  }
  if (!/\btest\s*\(/.test(text) && !/\btest\.describe\s*\(/.test(text)) {
    issues.push(`${name}: contains no Playwright test declaration`);
  }
  if (!/\bexpect\s*\(/.test(text)) {
    issues.push(`${name}: contains no assertion`);
  }
  if (/\.length\)\.toBeGreaterThanOrEqual\(0\)/.test(text)) {
    issues.push(`${name}: contains a tautological non-negative length assertion`);
  }
}

/* Every app page must be represented by the browser surface contract. Static
 * routes appear literally in the E2E suite. Dynamic records are covered by
 * dynamic-surfaces.spec.ts; edit routes require that source to be declared
 * editable. This catches the common drift where a new page is added but the
 * browser sweep never learns that it exists. */
const appDir = join(root, "src", "app");
const pageFiles = filesUnder(appDir).filter((path) => path.endsWith(`${sep}page.tsx`));
const dynamicText = readFileSync(join(e2eDir, "dynamic-surfaces.spec.ts"), "utf8");
const dynamicEntries = [
  ...dynamicText.matchAll(/prefix:\s*["']([^"']+)["']\s*,\s*editable:\s*(true|false)/g),
].map((match) => ({ prefix: match[1], editable: match[2] === "true" }));

function routeFor(path) {
  const parts = relative(appDir, path).split(sep).slice(0, -1);
  const visible = parts.filter((part) => !(part.startsWith("(") && part.endsWith(")")));
  return `/${visible.join("/")}`.replace(/\/$/, "") || "/";
}

for (const path of pageFiles) {
  const route = routeFor(path);
  const dynamic = route.includes("[");
  if (!dynamic) {
    if (route === "/") {
      if (!/page\.goto\(["']\/["']\)/.test(e2eCorpus))
        issues.push(`${rel(path)}: root route lacks E2E coverage`);
      continue;
    }
    if (!e2eCorpus.includes(`"${route}"`) && !e2eCorpus.includes(`'${route}'`)) {
      issues.push(`${rel(path)}: route ${route} lacks explicit E2E coverage`);
    }
    continue;
  }

  const visibleParts = route.split("/").filter(Boolean);
  const idIndex = visibleParts.findIndex((part) => part.startsWith("["));
  const prefix = `/${visibleParts.slice(0, idIndex).join("/")}/`;
  const entry = dynamicEntries.find((one) => one.prefix === prefix);
  if (!entry) {
    /* A platform-only detail may be covered by the platform E2E suite with a
     * real fixture record instead of the tenant-admin dynamic sweep. */
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directlyCovered = new RegExp(`["']${escapedPrefix}[^"']+["']`).test(e2eCorpus);
    if (!directlyCovered)
      issues.push(`${rel(path)}: dynamic prefix ${prefix} is absent from dynamic-surfaces.spec.ts`);
  } else if (route.endsWith("/edit") && !entry.editable) {
    issues.push(`${rel(path)}: edit route is not marked editable in dynamic-surfaces.spec.ts`);
  }
}

/* Vitest discovery contract: every source test must use one of the two file
 * names that vitest.config.ts includes, and integration tests must be explicit. */
const srcTests = filesUnder(join(root, "src")).filter((path) =>
  /\.(?:test|spec)\.(?:ts|tsx)$/.test(path),
);
for (const path of srcTests) {
  const name = rel(path);
  if (!/\.test\.(?:ts|tsx)$/.test(path))
    issues.push(`${name}: is not discoverable by the Vitest include patterns`);
  if (name.includes(".integration.") && !name.endsWith(".integration.test.ts")) {
    issues.push(`${name}: integration test must use .integration.test.ts`);
  }
}

/* Critical pure/security boundaries must have executable behavioral tests, not
 * only source-token gates. This is a risk-based coverage floor rather than a
 * vanity global percentage. */
for (const [source, test] of Object.entries({
  "src/lib/csv/safe-csv.ts": "src/lib/csv/safe-csv.test.ts",
  "src/lib/storage/s3-compatible.ts": "src/lib/storage/s3-compatible.test.ts",
  "src/lib/storage/scanner.ts": "src/lib/storage/scanner.test.ts",
  "src/lib/storage/reconciliation.ts": "src/lib/storage/reconciliation.test.ts",
  "src/lib/runtime-config.ts": "src/lib/runtime-config.test.ts",
  "src/modules/platform/worker-policy.ts": "src/modules/platform/worker-policy.test.ts",
})) {
  if (!existsSync(join(root, source))) issues.push(`${source}: critical source is missing`);
  if (!existsSync(join(root, test)))
    issues.push(`${source}: lacks required behavioral test ${test}`);
}

/* Release wiring is part of the test contract. A correct suite that CI never
 * invokes is still a false-green release. Keep the cheap static/unit gate, the
 * fail-closed integration command and the fresh-build E2E command connected to
 * their canonical scripts. */
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const scripts = packageJson.scripts ?? {};
if (!String(scripts.test ?? "").includes("--project unit")) {
  issues.push("package.json: test must be the explicit unit project");
}
if (!String(scripts["test:integration"] ?? "").includes("--project integration")) {
  issues.push("package.json: test:integration must invoke the integration project explicitly");
}
if (!String(scripts.check ?? "").includes("check:tests")) {
  issues.push("package.json: check must include the test-suite contract scanner");
}
for (const gate of [
  "check:maintainability",
  "check:tenant-schema-integrity",
  "check:data-contracts",
  "check:module-cycles",
  "check:source-reachability",
  "check:text-hygiene",
  "check:security-definers",
  "check:deployment-contracts",
  "check:storage-lifecycle",
  "check:backup-format",
  "check:runtime-closures",
]) {
  if (!String(scripts.check ?? "").includes(gate)) {
    issues.push(`package.json: check must include ${gate}`);
  }
}
const releaseAuditCommand = String(scripts["release:audit"] ?? "");
if (!releaseAuditCommand.includes("scripts/release-audit.mjs")) {
  issues.push(
    "package.json: release:audit must use the canonical cross-platform release-audit.mjs workflow",
  );
} else {
  const releaseAudit = readFileSync(join(root, "scripts", "release-audit.mjs"), "utf8");
  for (const token of ["typecheck:dependencies", "test:integration", "e2e"]) {
    if (!releaseAudit.includes(token)) {
      issues.push(`scripts/release-audit.mjs: missing required release gate ${token}`);
    }
  }
}
const releasePrepare = readFileSync(join(root, "scripts", "release-prepare.mjs"), "utf8");
if (!releasePrepare.includes(`Expected ${packageJson.packageManager}`)) {
  issues.push("scripts/release-prepare.mjs: package-manager guard must match package.json");
}
if (!releasePrepare.includes(`Expected Node ${packageJson.engines?.node}`)) {
  issues.push("scripts/release-prepare.mjs: Node engine guard must match package.json");
}
const secretCheck = readFileSync(join(root, "scripts", "check-secrets.mjs"), "utf8");
if (
  !secretCheck.includes("sourceFiles(root)") ||
  !secretCheck.includes('"git history unavailable"')
) {
  issues.push(
    "scripts/check-secrets.mjs: source archives must have a non-Git secret-scan fallback",
  );
}
const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
/* The check job may invoke the canonical aggregate (`pnpm check`) or the
 * scanner directly. package.json above proves that the aggregate includes
 * check:tests, so accepting it here keeps CI DRY without weakening coverage. */
if (!ci.includes("pnpm check") && !ci.includes("pnpm check:tests")) {
  issues.push("ci.yml: release pipeline does not invoke pnpm check/check:tests");
}
for (const command of ["pnpm test:integration", "node scripts/e2e/run.mjs --no-build"]) {
  if (!ci.includes(command)) issues.push(`ci.yml: release pipeline does not invoke ${command}`);
}
if (
  !/e2e:[\s\S]*?- name: Production build[\s\S]*?run: pnpm build[\s\S]*?node scripts\/e2e\/run\.mjs --no-build/.test(
    ci,
  )
) {
  issues.push("ci.yml: E2E job must build production before the --no-build shard runner");
}

/* Operational recovery is a release property too. Keep the drill wired to a
 * real PostgreSQL service and the same privilege checker production uses. */
const operationsStart = ci.indexOf("\n  operations:");
const e2eStart = ci.indexOf("\n  e2e:", operationsStart + 1);
const operations =
  operationsStart >= 0 ? ci.slice(operationsStart, e2eStart >= 0 ? e2eStart : undefined) : "";
for (const command of [
  "node scripts/platform-backup.mjs create",
  "node scripts/platform-backup.mjs verify",
  "node scripts/platform-backup.mjs restore",
  "pnpm production:db-check",
]) {
  if (!operations.includes(command))
    issues.push(`ci.yml: operations job does not invoke ${command}`);
}
if (!/image:\s*postgres:18/.test(operations)) {
  issues.push("ci.yml: operations restore drill must run against PostgreSQL 18");
}

/* Docker, CI and package.json must test the same Node minor. A floating major
 * can turn a green runner into a different runtime from the release image. */
/* pnpm/setup provisions Node through its `runtime: node@...` input rather
 * than actions/setup-node's `node-version`. Accept both equivalent forms,
 * while still requiring every declared runtime pin to be the exact release
 * minor promised by package.json. */
const nodePins = [...ci.matchAll(/node-version:\s*([^\n#]+)|runtime:\s*node@([^\n#]+)/g)].map(
  (match) => (match[1] ?? match[2]).trim(),
);
if (nodePins.length < 4 || nodePins.some((pin) => pin !== "24.20.0")) {
  issues.push("ci.yml: every job must pin Node 24.20.0 exactly");
}

if (issues.length > 0) {
  console.error(`test contract failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(
  `test contract OK: ${srcTests.length} Vitest files, ${specs.length} Playwright specs, ${pageFiles.length} app pages covered`,
);
