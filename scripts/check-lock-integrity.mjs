import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "pnpm-lock.yaml");
const lock = readFileSync(lockPath, "utf8");
const packagesMatch = lock.match(/^packages:\s*$([\s\S]*?)^snapshots:\s*$/m);
if (!packagesMatch) {
  console.error("Lockfile integrity check failed: packages/snapshots sections were not found.");
  process.exit(1);
}

const packages = packagesMatch[1];
const starts = [...packages.matchAll(/^ {2}(\S.*):\s*$/gm)];
const missing = [];
for (let i = 0; i < starts.length; i += 1) {
  const name = starts[i][1];
  const from = starts[i].index ?? 0;
  const to = i + 1 < starts.length ? (starts[i + 1].index ?? packages.length) : packages.length;
  const block = packages.slice(from, to);
  const registryTarball = block.match(
    /^\s{6}tarball:\s+(https:\/\/registry\.npmjs\.org\/\S+)\s*$/m,
  );
  if (!registryTarball) continue;
  if (!/^\s{6}integrity:\s+sha512-[A-Za-z0-9+/]+={0,2}\s*$/m.test(block)) {
    missing.push(`${name} -> ${registryTarball[1]}`);
  }
}

if (missing.length) {
  console.error(
    `Lockfile integrity check failed: ${missing.length} npm registry tarball(s) lack SHA-512 integrity.\n` +
      missing.map((value) => `- ${value}`).join("\n") +
      "\nRefresh the lockfile with the pinned pnpm on the certification host; never fabricate SRI values.",
  );
  process.exit(1);
}

console.log(
  "Lockfile integrity check passed: every explicit npm registry tarball has SHA-512 integrity.",
);
