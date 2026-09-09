import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runNode, runPnpm } from "./lib/run-command.mjs";

const root = resolve(import.meta.dirname, "..");
const check = join(root, "scripts", "check-drizzle-baseline.mjs");
try {
  runNode(check, ["--generation-ready"], { cwd: root, label: "Drizzle generation baseline check" });
  console.log("Drizzle metadata baseline is already current.");
  process.exit(0);
} catch {}

const journalPath = join(root, "drizzle", "meta", "_journal.json");
const before = JSON.parse(readFileSync(journalPath, "utf8"));
const beforeMax = Math.max(...before.entries.map((entry) => Number(entry.idx)));
console.log("Creating a metadata-only Drizzle baseline from the current schema...");
runPnpm(["exec", "drizzle-kit", "generate", "--custom", "--name=current_schema_baseline"], {
  cwd: root,
  label: "Drizzle metadata baseline generation",
});

const after = JSON.parse(readFileSync(journalPath, "utf8"));
const latest = [...after.entries].sort((a, b) => Number(a.idx) - Number(b.idx)).at(-1);
if (!latest || Number(latest.idx) <= beforeMax)
  throw new Error("Drizzle did not append a baseline migration");
const sqlPath = join(root, "drizzle", `${latest.tag}.sql`);
if (!existsSync(sqlPath)) throw new Error(`Baseline SQL file was not created: ${sqlPath}`);
const sql = readFileSync(sqlPath, "utf8");
if (/^\s*(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/im.test(sql)) {
  throw new Error(
    "Metadata baseline unexpectedly contains executable DDL/DML. Review and revert the generated baseline before continuing.",
  );
}
runNode(check, ["--generation-ready"], {
  cwd: root,
  label: "Generated Drizzle baseline verification",
});

const safetyPath = join(root, "drizzle", "migration-safety.json");
const safety = JSON.parse(readFileSync(safetyPath, "utf8"));
safety.migrations ??= {};
if (!safety.migrations[latest.tag]) {
  safety.migrations[latest.tag] = {
    additive: true,
    estimatedLockRisk: "low",
    backwardCompatible: true,
    notes:
      "Metadata-only Drizzle baseline. SQL is intentionally empty and the generated snapshot records the already-migrated current schema for safe future diff generation.",
    rollback:
      "Remove this metadata-only migration and snapshot only before any later migration has been generated from it.",
  };
  writeFileSync(safetyPath, `${JSON.stringify(safety, null, 2)}\n`, "utf8");
}
rmSync(join(root, "drizzle", "meta", "manual-baseline.json"), { force: true });
console.log(
  `Drizzle metadata baseline reconciled at ${latest.tag}. Review and commit the generated empty migration + snapshot + safety metadata.`,
);
