import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runPnpm } from "./lib/run-command.mjs";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.packageManager !== "pnpm@11.21.0") throw new Error("Expected pnpm@11.21.0");
if (pkg.engines?.node !== ">=24.20.0") throw new Error("Expected Node >=24.20.0");

step("Refreshing pnpm-lock.yaml for the current release dependency graph", [
  "install",
  "--lockfile-only",
]);
step("Verifying SHA-512 integrity for explicit npm registry tarballs", ["check:lock-integrity"]);
step("Installing exactly the refreshed locked graph", ["install", "--frozen-lockfile"]);
step("Generating official Better Auth schema for reconciliation", ["auth:schema:reconcile"]);
step("Reconciling Drizzle generation metadata baseline", ["drizzle:reconcile"]);
step("Running public-release hygiene against the refreshed dependency lock", [
  "check:public-release",
]);
console.log(
  "\nRelease preparation complete. Review and commit pnpm-lock.yaml plus deliberate schema/migration reconciliation before release:audit.",
);

function step(name, command) {
  console.log(`\n=== ${name} ===`);
  runPnpm(command, { cwd: root, label: name });
}
