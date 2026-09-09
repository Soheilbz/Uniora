import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".runtime-closures");
rmSync(output, { recursive: true, force: true });
try {
  const run = spawnSync(process.execPath, [join(root, "scripts/prepare-runtime-closures.mjs")], {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`runtime closure build failed:\n${run.stderr || run.stdout}`);
  }

  const files = walk(output);
  const forbiddenTyped = files.filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file));
  if (forbiddenTyped.length) {
    throw new Error(`runtime closure contains TypeScript source: ${forbiddenTyped.join(", ")}`);
  }
  for (const required of [
    "tenant/scripts/job-worker.mjs",
    "platform/scripts/platform-worker.js",
    "platform/scripts/platform-backup.mjs",
    "operations/scripts/production-db-check.mjs",
  ]) {
    if (!files.includes(required)) throw new Error(`runtime closure is missing ${required}`);
  }
  for (const forbidden of [
    "tenant/scripts/platform-worker.js",
    "tenant/scripts/platform-backup.mjs",
    "tenant/scripts/db.mjs",
  ]) {
    if (files.includes(forbidden))
      throw new Error(`tenant runtime closure leaks privileged code: ${forbidden}`);
  }
  console.log(`runtime closure build ok (${files.length} emitted JavaScript/runtime files)`);
} finally {
  rmSync(output, { recursive: true, force: true });
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && statSync(full).isFile()) {
      out.push(relative(output, full).replaceAll("\\", "/"));
    }
  }
  return out;
}
