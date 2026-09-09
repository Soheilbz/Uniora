import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendor = join(root, "toolchain", "pnpm", "11.21.0");
const manifest = JSON.parse(readFileSync(join(vendor, "manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(vendor, "package.json"), "utf8"));
const projectPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];

if (manifest.name !== "pnpm") failures.push("vendored toolchain manifest name is not pnpm");
if (manifest.version !== "11.21.0")
  failures.push("vendored toolchain manifest version is not 11.21.0");
if (packageJson.name !== "pnpm" || packageJson.version !== manifest.version) {
  failures.push("vendored pnpm package metadata does not match the manifest");
}
if (projectPackage.packageManager !== `pnpm@${manifest.version}`) {
  failures.push(`package.json must pin pnpm@${manifest.version}`);
}
if (projectPackage.scripts?.["docker:preflight"] !== "node scripts/docker-preflight.mjs") {
  failures.push("package.json must expose the Docker registry preflight diagnostic");
}
if (projectPackage.scripts?.["docker:cleanup"] !== "node scripts/docker-cleanup.mjs") {
  failures.push("package.json must expose the bounded Docker cleanup policy");
}

for (const [relative, expected] of Object.entries(manifest.runtimeFiles ?? {})) {
  const file = join(vendor, relative);
  try {
    if (!statSync(file).isFile()) throw new Error("not a regular file");
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== expected) failures.push(`${relative} hash mismatch: ${actual}`);
  } catch (error) {
    failures.push(`${relative} is missing or unreadable: ${error.message}`);
  }
}

try {
  const version = execFileSync(process.execPath, [join(vendor, "bin", "pnpm.mjs"), "--version"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (version !== manifest.version)
    failures.push(`vendored pnpm reports ${version}, expected ${manifest.version}`);
} catch (error) {
  failures.push(`vendored pnpm could not execute: ${error.message}`);
}

const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
for (const token of [
  `FROM \${NODE_IMAGE} AS pnpm-toolchain`,
  "COPY toolchain/pnpm/11.21.0/ ./",
  "FROM pnpm-toolchain AS dependencies",
  "pnpm install --frozen-lockfile",
  "pnpm install --prod --no-optional --offline --frozen-lockfile --store-dir=/tmp/pnpm-store",
  "pnpm prune --prod --no-optional",
  "-name 'auth@*' -prune -exec rm -rf '{}' +",
  "libcrypto3=3.5.8-r0",
  "libssl3=3.5.8-r0",
  "postgresql18-client=18.6-r0",
]) {
  if (!dockerfile.includes(token))
    failures.push(`Dockerfile is missing the pinned toolchain contract: ${token}`);
}
const dockerBuildHelper = readFileSync(join(root, "scripts/docker-build.mjs"), "utf8");
for (const token of [
  'runCleanup(selectedImageRefs, "pre-build")',
  "org.opencontainers.image.source=https://github.com/Soheilbz/Uniora",
  "com.univ-web.managed=true",
]) {
  if (!dockerBuildHelper.includes(token))
    failures.push(`Docker build helper is missing the bounded artifact contract: ${token}`);
}
if (!existsSync(join(root, "scripts/docker-cleanup.mjs")))
  failures.push("Docker build helper cleanup script is missing");
if (dockerfile.includes("corepack enable")) {
  failures.push("Dockerfile must not acquire pnpm through Corepack at build time");
}
if (dockerfile.includes("apk upgrade --no-cache")) {
  failures.push("Dockerfile must not resolve an unpinned Alpine upgrade during image builds");
}
const dockerCleanup = readFileSync(join(root, "scripts/docker-cleanup.mjs"), "utf8");
if (dockerCleanup.includes('"--all"')) {
  failures.push("Docker cleanup must not use buildx prune --all on a shared/default builder");
}
if (dockerfile.includes("apk add --no-cache ca-certificates")) {
  failures.push("Dockerfile must not reacquire the CA bundle already present in the pinned base");
}
if (/^# syntax=docker\/dockerfile:/m.test(dockerfile)) {
  failures.push(
    "Dockerfile must use the bundled BuildKit frontend instead of resolving a Docker Hub frontend",
  );
}
for (const workflow of [".github/workflows/ci.yml", ".github/workflows/supply-chain.yml"]) {
  const source = readFileSync(join(root, workflow), "utf8");
  if (!source.includes("pnpm docker:build"))
    failures.push(`${workflow} must use the repository Docker build helper`);
  if (!source.includes("pnpm docker:cleanup --apply"))
    failures.push(`${workflow} must run bounded Docker cleanup after image qualification`);
  if (source.includes("corepack prepare pnpm@"))
    failures.push(`${workflow} must use the vendored pnpm runtime`);
}

if (failures.length) {
  console.error(`Docker toolchain contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Docker toolchain contract ok (pnpm ${manifest.version}; ${Object.keys(manifest.runtimeFiles).length} hashed runtime files)`,
);
