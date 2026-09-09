import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/operations-env.mjs <script> [...args]");
  process.exit(64);
}

/*
 * Keep operational credentials out of the Web process while making the
 * developer and production command paths deterministic. The local file is
 * deliberately preferred for this checkout; a deployed host normally keeps
 * only the non-local operations file or injects equivalent process variables.
 */
const envFile = [".env.operations.local", ".env.operations"]
  .map((name) => resolve(root, name))
  .find((candidate) => existsSync(candidate));
const childArgs = envFile ? [`--env-file=${envFile}`, ...args] : args;
const child = spawn(process.execPath, childArgs, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`Unable to start operations command: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
