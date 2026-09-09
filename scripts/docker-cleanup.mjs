import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const apply = process.argv.includes("--apply");
const builder = value("UNIV_DOCKER_BUILDER", "default");
const maxUsedSpace = value("UNIV_DOCKER_MAX_USED_SPACE", "32GB");
const keep = new Set([
  `univ-web:${version}`,
  `univ-web-tenant-worker:${version}`,
  `univ-web-platform-worker:${version}`,
  `univ-web-operations:${version}`,
  ...process.argv
    .filter((argument) => argument.startsWith("--keep="))
    .flatMap((argument) => argument.slice("--keep=".length).split(","))
    .map((reference) => reference.trim())
    .filter(Boolean),
]);

const imageList = run("docker", ["image", "ls", "--format", "{{.Repository}}\t{{.Tag}}\t{{.ID}}"]);
const candidates = imageList
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.split("\t"))
  .filter(
    ([repository, tag]) =>
      /^(univ-web|univ-web-(?:tenant-worker|platform-worker|operations|runner))$/.test(
        repository,
      ) && /^(?:closure-.+|repro-.+|ci|supply-chain|.+-stabilized)$/.test(tag),
  )
  .map(([repository, tag, id]) => ({ repository, tag, id, reference: `${repository}:${tag}` }))
  .filter(({ reference }) => !keep.has(reference));

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      builder,
      maxUsedSpace,
      protectedImages: [...keep].sort(),
      removableImages: candidates,
      policy:
        "Only known Univ Web qualification/CI tags are eligible; unrelated images and production-version tags are untouched.",
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);

for (const { reference } of candidates) {
  run("docker", ["image", "rm", reference]);
}

run("docker", [
  "buildx",
  "prune",
  "--builder",
  builder,
  "--force",
  "--max-used-space",
  maxUsedSpace,
]);

function value(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}
