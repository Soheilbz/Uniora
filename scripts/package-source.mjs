import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(pkg.version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${version || "<empty>"}`);
}

// Remove only this tool's prior outputs before source-policy checks so reruns stay idempotent.
const output = join(root, `univ-web-${version}-source.zip`);
rmSync(output, { force: true });
rmSync(`${output}.sha256`, { force: true });

run(process.execPath, [join(root, "scripts", "check-public-release.mjs")]);
run(process.execPath, [join(root, "scripts", "check-source-package.mjs")]);

const directories = [
  ".github",
  "db",
  "deploy",
  "docs",
  "drizzle",
  "e2e",
  "scripts",
  "src",
  "test-support",
  "toolchain",
];
const files = [
  ".dockerignore",
  ".env.database.example",
  ".env.database.local.example",
  ".env.example",
  ".env.operations.example",
  ".env.platform-worker.example",
  ".env.production.example",
  ".env.worker.example",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  ".nvmrc",
  ".npmrc",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "Dockerfile",
  "README.md",
  "README.fa.md",
  "biome.jsonc",
  "components.json",
  "drizzle.config.ts",
  "next.config.ts",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "tsconfig.json",
  "vitest.config.ts",
];

const entries = [];
for (const directory of directories) {
  const absolute = join(root, directory);
  if (!statSync(absolute).isDirectory()) throw new Error(`Missing source directory: ${directory}`);
  collectFiles(absolute, entries);
}
for (const file of files) {
  const absolute = join(root, file);
  if (!statSync(absolute).isFile()) throw new Error(`Missing source file: ${file}`);
  entries.push(absolute);
}

const normalized = entries
  .map((absolute) => ({
    absolute,
    name: relative(root, absolute).replaceAll("\\", "/"),
    mode: statSync(absolute).mode,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

const names = new Set();
for (const entry of normalized) {
  if (!entry.name || entry.name.startsWith("/") || entry.name.includes("\\")) {
    throw new Error(`Unsafe or non-portable archive path: ${entry.name}`);
  }
  if (entry.name.split("/").includes(".."))
    throw new Error(`Path traversal in archive entry: ${entry.name}`);
  if (names.has(entry.name)) throw new Error(`Duplicate archive entry: ${entry.name}`);
  names.add(entry.name);
}

const archive = createZip(normalized);
writeFileSync(output, archive);
const digest = createHash("sha256").update(archive).digest("hex");
writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`, "ascii");
console.log(`Created ${output}`);
console.log(`SHA-256 ${digest}`);
console.log(
  `Portable ZIP entries: ${normalized.length} (forward-slash paths, deterministic timestamps)`,
);

function collectFiles(directory, out) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const name = relative(root, absolute).replaceAll("\\", "/");
    // Playwright writes credentials, session state, traces, screenshots, and
    // other disposable evidence below these namespaces. They are excluded by
    // the release policy and must never enter a public source archive.
    if (
      name === "e2e/.auth" ||
      name === "e2e/.state.json" ||
      name.startsWith("e2e/.auth/") ||
      /^e2e\/.run-[^/]+(?:\/|$)/.test(name)
    )
      continue;
    if (entry.isDirectory()) collectFiles(absolute, out);
    else if (entry.isFile()) out.push(absolute);
    else throw new Error(`Unsupported source entry type: ${relative(root, absolute)}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function createZip(input) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 33; // 1980-01-01; deterministic source archives.

  for (const entry of input) {
    const name = Buffer.from(entry.name, "utf8");
    const data = readFileSync(entry.absolute);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    if (data.length > 0xffffffff || compressed.length > 0xffffffff || offset > 0xffffffff) {
      throw new Error(
        "Source archive requires ZIP64, which this deterministic writer intentionally rejects",
      );
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names.
    local.writeUInt16LE(8, 8); // deflate.
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // Unix, ZIP 2.0.
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const unixMode = (0o100000 | (entry.mode & 0o777)) << 16;
    central.writeUInt32LE(unixMode >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  if (input.length > 0xffff)
    throw new Error("Source archive has too many entries for non-ZIP64 output");
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(input.length, 8);
  end.writeUInt16LE(input.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
