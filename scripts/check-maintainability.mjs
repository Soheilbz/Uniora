import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SOURCE_HARD_LIMIT = 800;
const OPERATIONS_HARD_LIMIT = 2500;
const SOFT_LIMIT = 500;

/*
 * Line-count gates are a cohesion ratchet, not a refactoring target by
 * themselves. Large modules that were explicitly audited may shrink, but may
 * not grow. New modules above the soft limit must be decomposed before merge.
 *
 * Application source uses a tighter hard ceiling. Operational scripts have a
 * separate ceiling because a few pre-existing release/worker tools are larger;
 * they are still ratcheted at their exact audited size so this exception cannot
 * become fresh headroom. Shared policy/format/lifecycle logic should move into
 * scripts/lib rather than making the process entry points larger.
 */
const auditedBaseline = new Map(
  Object.entries({
    // Application source (audited 2026-09-05/06).
    "src/db/vocabulary.ts": 695,
    "src/modules/capacity/regulation.ts": 685,
    "src/app/(app)/workshops/page.tsx": 611,
    "src/db/schema/registry.ts": 598,
    "src/modules/worksheets/final.ts": 550,
    "src/app/(app)/page.tsx": 534,
    "src/app/(app)/council-decisions/page.tsx": 538,
    "src/modules/settings/data-quality.ts": 534,
    "src/modules/council/queries.ts": 600,
    "src/components/engine/register-view.tsx": 515,
    "src/modules/integrations/connections.ts": 552,

    // Operational/release tooling. These are grandfathered at the exact
    // current size only; any growth requires extraction into cohesive modules.
    "scripts/db.mjs": 675,
  }),
);

const files = [];
function walk(directory, scope) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(full, scope);
      continue;
    }
    if (!/\.(?:ts|tsx|mts|js|mjs|cjs)$/.test(entry.name)) continue;
    if (/\.(?:test|spec)\.(?:ts|tsx|mts|js|mjs|cjs)$/.test(entry.name)) continue;
    files.push({ full, scope });
  }
}
walk(join(root, "src"), "source");
walk(join(root, "scripts"), "operations");

const failures = [];
for (const { full, scope } of files) {
  const rel = relative(root, full).replaceAll("\\", "/");
  const lines = readFileSync(full, "utf8").split(/\r?\n/).length - 1;
  const hardLimit = scope === "source" ? SOURCE_HARD_LIMIT : OPERATIONS_HARD_LIMIT;
  if (lines > hardLimit) {
    failures.push(`${rel}: ${lines} lines exceeds ${scope} hard limit ${hardLimit}`);
    continue;
  }
  if (lines <= SOFT_LIMIT) continue;
  const baseline = auditedBaseline.get(rel);
  if (baseline === undefined) {
    failures.push(`${rel}: new ${lines}-line ${scope} module exceeds soft limit ${SOFT_LIMIT}`);
  } else if (lines > baseline) {
    failures.push(
      `${rel}: grew from audited baseline ${baseline} to ${lines} lines; extract cohesive logic before adding more`,
    );
  }
}

for (const [rel, baseline] of auditedBaseline) {
  const full = join(root, rel);
  if (!existsSync(full)) {
    failures.push(`${rel}: audited large-module baseline is stale; remove its exemption`);
    continue;
  }
  const lines = readFileSync(full, "utf8").split(/\r?\n/).length - 1;
  if (lines <= SOFT_LIMIT) {
    failures.push(
      `${rel}: shrank below soft limit (${lines} <= ${SOFT_LIMIT}); remove its stale ${baseline}-line exemption`,
    );
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
const sourceCount = files.filter((entry) => entry.scope === "source").length;
const operationsCount = files.length - sourceCount;
console.log(
  `maintainability ratchet ok (${sourceCount} source + ${operationsCount} operational modules; soft=${SOFT_LIMIT}, hard=${SOURCE_HARD_LIMIT}/${OPERATIONS_HARD_LIMIT})`,
);
