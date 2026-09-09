import { resolve } from "node:path";
import { frozenInstallArgs, runPnpm } from "./lib/run-command.mjs";

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const skipRuntime = args.has("--skip-runtime");
const skipE2e = args.has("--skip-e2e");

step("Install exact dependency graph", frozenInstallArgs(root));
step("Public release hygiene", ["check:public-release"]);
step("Better Auth schema reconciliation", ["auth:schema:reconcile"]);
step("Migration safety metadata", ["check:migration-safety"]);
step("Drizzle migration metadata contract", ["check:drizzle-baseline"]);
step("Source/type/lint/static/unit gates", ["check"]);
step("Dependency typecheck", ["typecheck:dependencies"]);
if (!skipRuntime) {
  step("Database migrate", ["db:migrate"]);
  step("Runtime database roles and canonical grants", ["db:setup"]);
  step("Production database privilege/RLS check", ["production:db-check"]);
  step("Database observability snapshot", ["db:health"]);
  step("DR/PITR readiness", ["dr:status"]);
  step("Integration tests", ["test:integration"]);
  if (!skipE2e) step("End-to-end release gate", ["e2e"]);
}
console.log("\nRelease audit gates completed.");

function step(name, command) {
  console.log(`\n=== ${name} ===`);
  runPnpm(command, { cwd: root, label: name });
}
