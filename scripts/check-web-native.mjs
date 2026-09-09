import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Release guard for the Web-native baseline.
 *
 * Product history is not a runtime concern and must not quietly re-enter copy,
 * comments, compatibility branches, or current permission vocabularies. This
 * deliberately uses narrow phrases so ordinary responsive-Web terms such as
 * "desktop viewport" are not rejected.
 */
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

function* filesUnder(root) {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if ([".git", "node_modules", ".next", ".next-dev", ".univ"].includes(name)) continue;
      yield* filesUnder(path);
    } else {
      yield path;
    }
  }
}

const lineagePatterns = [
  /desktop application/i,
  /desktop client/i,
  /previous product/i,
  /old product/i,
  /legacy client/i,
  /old client/i,
  /product this replaces/i,
  /whole-device/i,
  /device archive/i,
  /offline mode/i,
  /sync-failure/i,
  /developer tier/i,
  /developer account/i,
];

for (const area of ["src", "scripts", "e2e", "docs", "README.md"]) {
  const root = join(ROOT, area);
  const candidates = statSafe(root)?.isFile() ? [root] : [...filesUnder(root)];
  for (const file of candidates) {
    if (!isTextFile(file) || rel(file) === "scripts/check-web-native.mjs") continue;
    const source = readFileSync(file, "utf8");
    for (const pattern of lineagePatterns) {
      if (pattern.test(source)) {
        failures.push(`${rel(file)}: product-lineage phrase ${pattern}`);
      }
    }
  }
}

// The old generic council lookup and platform-only capabilities are forbidden
// in the current application. Historical SQL migrations are intentionally not
// scanned: migrations are an immutable upgrade ledger, and 0027 removes those
// capabilities from upgraded databases.
for (const area of ["src", "scripts", "e2e", "docs", "README.md"]) {
  const root = join(ROOT, area);
  const candidates = statSafe(root)?.isFile() ? [root] : [...filesUnder(root)];
  for (const file of candidates) {
    if (!isTextFile(file) || rel(file) === "scripts/check-web-native.mjs") continue;
    const source = readFileSync(file, "utf8");
    if (/(?<!decision_)(?<!ruling_)\breport_categories\b/.test(source)) {
      failures.push(`${rel(file)}: generic report_categories lookup`);
    }
    if (/\b(?:data\.backup|education\.view|education\.manage)\b/.test(source)) {
      failures.push(`${rel(file)}: removed Web capability`);
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} Web-native baseline violation(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("web-native baseline: ok");

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
function isTextFile(path) {
  return /(?:\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|txt|yml|yaml)|README\.md)$/i.test(path);
}
function rel(path) {
  return relative(ROOT, path).split(sep).join("/");
}
