import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const productionPackages = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);
const failures = [];
const seeds = new Set([
  "scripts/job-worker.mjs",
  "scripts/platform-worker.ts",
  "scripts/platform-backup.mjs",
  "scripts/platform.mjs",
  "scripts/create-tenant.ts",
  "scripts/create-tenant-user.ts",
  "scripts/reset-tenant-user-password.ts",
  "scripts/production-db-check.mjs",
  "scripts/worker-production-check.mjs",
  "scripts/platform-worker-production-check.mjs",
]);

// Platform worker delegates privileged operations to child scripts. Keep those
// literal targets part of the runtime closure even if the generic import walk
// cannot see spawn() edges.
const platformWorkerSource = readFileSync(join(root, "scripts/platform-worker.ts"), "utf8");
for (const match of platformWorkerSource.matchAll(/runScript\(\s*["']([^"']+)["']/g)) {
  seeds.add(match[1]);
}

const importPattern =
  /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()\s*["']([^"']+)["']/g;
const queue = [...seeds].map((item) => resolve(root, item));
const visited = new Set();
const packages = new Set();
let references = 0;

while (queue.length) {
  const file = queue.pop();
  if (!file || visited.has(file)) continue;
  visited.add(file);
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!file.startsWith(`${root}/`) && file !== root) {
    failures.push(`worker runtime escapes repository root: ${file}`);
    continue;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.push(`worker runtime file is missing: ${rel}`);
    continue;
  }
  if (extname(file) === ".tsx") failures.push(`worker runtime must not require TSX/JSX: ${rel}`);

  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    references += 1;
    const specifier = match[1];
    if (specifier.startsWith("node:")) continue;
    if (specifier.startsWith("@/")) {
      failures.push(
        `${rel}: tsconfig alias is not supported by the Node worker runtime: ${specifier}`,
      );
      continue;
    }
    if (specifier.startsWith(".")) {
      if (!extname(specifier)) {
        failures.push(
          `${rel}: relative worker import must include its file extension: ${specifier}`,
        );
        continue;
      }
      const target = normalize(resolve(dirname(file), specifier));
      if (!target.startsWith(`${root}/`)) {
        failures.push(`${rel}: relative import escapes repository root: ${specifier}`);
        continue;
      }
      if (!existsSync(target) || !statSync(target).isFile()) {
        failures.push(`${rel}: unresolved worker import: ${specifier}`);
        continue;
      }
      queue.push(target);
      continue;
    }
    if (specifier.startsWith("/")) {
      failures.push(
        `${rel}: absolute filesystem import is forbidden in worker runtime: ${specifier}`,
      );
      continue;
    }
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    packages.add(packageName);
    if (!productionPackages.has(packageName)) {
      failures.push(
        `${rel}: runtime package ${packageName} is not declared in dependencies/optionalDependencies`,
      );
    }
  }
}

const runtimeClosureBuilder = readFileSync(
  join(root, "scripts/prepare-runtime-closures.mjs"),
  "utf8",
);
for (const token of [
  "ts.transpileModule",
  "assertJavaScriptOnly",
  'rel.replace(typedExtension, ".js")',
]) {
  if (!runtimeClosureBuilder.includes(token))
    failures.push(`runtime closure builder is missing JavaScript-emission contract: ${token}`);
}
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
if (!dockerfile.includes('CMD ["node", "scripts/platform-worker.js"]')) {
  failures.push("Dockerfile: platform worker must execute the emitted JavaScript entrypoint");
}
if (/CMD \["node", "[^"]+\.(?:ts|mts|tsx)"\]/.test(dockerfile)) {
  failures.push("Dockerfile: production runtime must not execute TypeScript source directly");
}

for (const seed of seeds) {
  if (!existsSync(join(root, seed))) failures.push(`worker entry/delegate is missing: ${seed}`);
}

const maintenanceSource = readFileSync(
  join(root, "scripts/tenant-worker/maintenance-handlers.mjs"),
  "utf8",
);
for (const required of [
  "job_attempts: Object.freeze(",
  'authority: "control"',
  "applyControlRetentionPolicy(job.tenant_id",
  "tenant_id=$1 and (" + "$" + "{spec.predicate})",
]) {
  if (!maintenanceSource.includes(required)) {
    failures.push(`worker-owned attempt retention contract is missing: ${required}`);
  }
}

if (failures.length) {
  console.error(
    `Worker-runtime contract failed (${failures.length} issues):\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}
console.log(
  `worker runtime contract ok (${visited.size} files, ${references} imports, ${packages.size} production packages)`,
);
