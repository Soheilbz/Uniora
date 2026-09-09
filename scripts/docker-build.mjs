import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const targets = ["runner", "tenant-worker", "platform-worker", "operations"];
const requestedTargets = process.argv
  .filter((argument) => argument.startsWith("--target="))
  .map((argument) => argument.slice("--target=".length));
const selectedTargets = requestedTargets.length ? requestedTargets : targets;
const offline = !process.argv.includes("--online");
const noCache = process.argv.includes("--no-cache");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const store = resolve(process.env.UNIV_PNPM_STORE ?? join(root, ".univ", "cache", "pnpm-store"));
const metadata = resolve(
  process.env.UNIV_PNPM_METADATA ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "pnpm"),
);

if (selectedTargets.some((target) => !targets.includes(target))) {
  throw new Error(`Unknown target. Choose one of: ${targets.join(", ")}`);
}
if (!existsSync(store) || !statSync(store).isDirectory()) {
  throw new Error(
    `Verified pnpm store is missing: ${store}\n` +
      "Populate it with the pinned pnpm install, then rerun; refusing an implicit registry retry.",
  );
}
if (!existsSync(metadata) || !statSync(metadata).isDirectory()) {
  throw new Error(
    `Verified pnpm metadata cache is missing: ${metadata}\n` +
      "Populate it with the pinned pnpm install, then rerun; refusing an implicit registry retry.",
  );
}
const storeIndex = join(store, "v11", "index.db");
if (!existsSync(storeIndex)) throw new Error(`pnpm v11 store index is missing: ${storeIndex}`);
const storeIndexText = readFileSync(storeIndex, "utf8");
for (const packageKey of [
  "@swc/core-linux-x64-musl@1.16.2",
  "@next/swc-linux-x64-musl@16.3.4",
  "lightningcss-linux-x64-musl@1.32.0",
]) {
  if (!storeIndexText.includes(`\t${packageKey}`)) {
    throw new Error(
      `verified pnpm store lacks the production Linux/musl package ${packageKey}; ` +
        "populate the target-ABI cache from a checksum-verified tarball before building",
    );
  }
}

run("docker", ["info", "--format", "{{.ServerVersion}}"]);
run("docker", ["buildx", "version"]);

for (const target of selectedTargets) {
  const tag =
    process.env[`UNIV_${target.replaceAll("-", "_").toUpperCase()}_IMAGE`] ??
    `univ-web-${target}:${version}-stabilized`;
  const args = [
    "buildx",
    "build",
    "--load",
    "--progress=plain",
    "--build-context",
    `pnpm-store=${store}`,
    "--build-context",
    `pnpm-metadata=${metadata}`,
    "--build-arg",
    `UNIV_PNPM_INSTALL=${offline ? "offline" : "online"}`,
    "--target",
    target,
    "--tag",
    tag,
  ];
  if (noCache) args.push("--no-cache");
  args.push(".");
  console.log(
    `Building ${target} from pinned base/toolchain with ${offline ? "offline" : "bounded-online"} dependency acquisition: ${tag}`,
  );
  run("docker", args);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
