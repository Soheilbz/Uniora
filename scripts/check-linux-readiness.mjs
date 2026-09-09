import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const read = (path) => readFileSync(join(root, path), "utf8");

for (const path of [
  "deploy/compose.production.yml",
  "deploy/prepare-host.sh",
  "deploy/host-preflight.sh",
  "deploy/nginx/univ-web.conf.example",
  "deploy/systemd/univ-web-compose.service",
  "docs/linux-deployment.md",
  "scripts/package-source.mjs",
  "scripts/prepare-standalone.mjs",
  "scripts/linux-host-preflight.mjs",
  "scripts/release-audit.mjs",
  "scripts/release-prepare.mjs",
  "scripts/reconcile-auth-schema.mjs",
  "scripts/reconcile-drizzle-baseline.mjs",
  "scripts/db-generate.mjs",
  "scripts/check-case-sensitive-imports.mjs",
  "scripts/worker-production-check.mjs",
  "scripts/platform-worker-production-check.mjs",
  "scripts/platform-worker-env.mjs",
  "scripts/check-worker-runtime.mjs",
  "scripts/lib/worker-role-policy.mjs",
  ".env.worker.example",
  ".env.platform-worker.example",
]) {
  if (!existsSync(join(root, path))) failures.push(`missing Linux deployment artifact: ${path}`);
}

const pkg = JSON.parse(read("package.json"));
if (!String(pkg.scripts?.build ?? "").includes("scripts/prepare-standalone.mjs"))
  failures.push("package.json: build does not stage a self-contained standalone artifact");
for (const name of [
  "db:generate",
  "auth:schema:reconcile",
  "release:prepare",
  "release:audit",
  "source:package",
]) {
  const command = String(pkg.scripts?.[name] ?? "");
  if (!command) failures.push(`package.json: missing ${name}`);
  if (/powershell|\.ps1\b/i.test(command))
    failures.push(`package.json: ${name} remains PowerShell-only`);
}

for (const envFile of [
  ".env.production.example",
  ".env.operations.example",
  ".env.worker.example",
  ".env.platform-worker.example",
]) {
  const text = read(envFile);
  if (/\b[A-Za-z]:[\\/]/.test(text))
    failures.push(`${envFile}: Windows absolute path remains in Linux production template`);
}

const dockerfile = read("Dockerfile");
for (const token of [
  "AS runner",
  "AS tenant-worker",
  "AS platform-worker",
  "AS operations",
  "USER node",
  "postgresql18-client",
  'CMD ["node", "server.js"]',
]) {
  if (!dockerfile.includes(token)) failures.push(`Dockerfile: missing ${token}`);
}
const compose = read("deploy/compose.production.yml");
for (const token of [
  "127.0.0.1:" + "$" + "{UNIV_WEB_PORT:-3000}:3000",
  "read_only: true",
  "pull_policy: never",
  "cap_drop:",
  "no-new-privileges:true",
  "job-worker:",
  "platform-worker:",
  "operations:",
  'profiles: ["tools"]',
  "/etc/univ-web/web.env",
  "/etc/univ-web/worker.env",
  "/etc/univ-web/platform-worker.env",
  "/etc/univ-web/operations.env",
  "DR_REPORT_DIR: /var/lib/univ-web/dr-reports",
  "/dr-reports",
]) {
  if (!compose.includes(token)) failures.push(`compose.production.yml: missing ${token}`);
}

if (!String(pkg.scripts?.["check:case-imports"] ?? "").includes("check-case-sensitive-imports.mjs"))
  failures.push("package.json: case-sensitive import gate is not wired");
if (!String(pkg.scripts?.["production:worker-check"] ?? "").includes("worker-production-check.mjs"))
  failures.push("package.json: tenant-worker production preflight is not wired");
if (
  !String(pkg.scripts?.["production:platform-worker-check"] ?? "").includes(
    "platform-worker-production-check.mjs",
  )
)
  failures.push("package.json: Platform-worker production preflight is not wired");
if (!String(pkg.scripts?.["check:worker-runtime"] ?? "").includes("check-worker-runtime.mjs"))
  failures.push("package.json: worker runtime closure gate is not wired");
if (
  !dockerfile.includes(".runtime-closures/tenant/") ||
  !dockerfile.includes(".runtime-closures/platform/") ||
  !dockerfile.includes(".runtime-closures/operations/")
)
  failures.push("Dockerfile: isolated runtime closure targets are not wired");
if (!String(pkg.scripts?.["job:worker"] ?? "").includes("worker-env.mjs"))
  failures.push("package.json: tenant worker still loads the privileged operations environment");
const workerSource = read("scripts/job-worker.mjs");
if (
  !workerSource.includes("DATABASE_WORKER_URL") ||
  workerSource.includes("process.env.DATABASE_ADMIN_URL")
)
  failures.push("job-worker.mjs: tenant worker does not enforce its dedicated database role");
const jobWorkerCompose = compose.split("  job-worker:")[1]?.split("  platform-worker:")[0] ?? "";
if (jobWorkerCompose.includes("UNIV_WEB_OPERATIONS_ENV_FILE"))
  failures.push("compose.production.yml: tenant worker receives the privileged operations env");
const platformWorkerCompose =
  compose.split("  platform-worker:")[1]?.split("  operations:")[0] ?? "";
if (platformWorkerCompose.includes("UNIV_WEB_OPERATIONS_ENV_FILE"))
  failures.push(
    "compose.production.yml: long-running Platform worker receives the full operations env",
  );
if (!platformWorkerCompose.includes("UNIV_WEB_PLATFORM_WORKER_ENV_FILE"))
  failures.push("compose.production.yml: Platform worker does not use its dedicated env");
const operationsCompose = compose.split("  operations:")[1] ?? "";
if (!operationsCompose.includes('profiles: ["tools"]'))
  failures.push("compose.production.yml: privileged operations service is not profile-gated");
const hostPreflight = read("deploy/host-preflight.sh");
if (!hostPreflight.includes('"$DATA_ROOT/dr-reports"'))
  failures.push("host-preflight.sh: persistent DR report directory is not checked");
const prepareHost = read("deploy/prepare-host.sh");
if (!prepareHost.includes("dr-reports"))
  failures.push("prepare-host.sh: persistent DR report directory is not created");
const launcher = read("scripts/web.mjs");
for (const token of ["xdg-open", "serverOwned", 'process.platform !== "linux"']) {
  if (!launcher.includes(token))
    failures.push(`scripts/web.mjs: missing Linux-only launcher contract ${token}`);
}
const packager = read("scripts/package-source.mjs");
for (const token of [
  'replaceAll("\\\\", "/")',
  "Path traversal in archive entry",
  "deterministic source archives",
  "CRC_TABLE",
]) {
  if (!packager.includes(token))
    failures.push(`scripts/package-source.mjs: missing portability contract ${token}`);
}
const release = read(".github/workflows/release.yml");
if (!release.includes("runs-on: ubuntu-latest"))
  failures.push("release.yml: signed source release is not Linux-native");
if (/powershell|pwsh/i.test(release))
  failures.push("release.yml: PowerShell dependency remains in Linux signed release job");

if (failures.length) {
  console.error(
    `Linux-readiness contract failed (${failures.length} issues):\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}
console.log(
  "Linux-readiness contract OK: portable release tooling, hardened container stack and Linux production paths are present.",
);
