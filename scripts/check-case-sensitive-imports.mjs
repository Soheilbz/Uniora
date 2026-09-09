/**
 * Cross-platform import casing gate.
 *
 * case-insensitive development filesystems can resolve an import whose casing does
 * not match the repository. Linux containers cannot. Walk every internal module
 * reference (relative and the tsconfig `@/` alias) and compare each path component
 * against the directory entry's exact
 * spelling so the failure is caught before deployment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = ["src", "scripts", "e2e"];
const srcAliasPrefix = "@/";
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const resolutionExtensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".json",
];
const failures = [];
let references = 0;
let files = 0;

for (const sourceRoot of roots) {
  walk(join(root, sourceRoot));
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log(
  `case-sensitive imports ok (${references} internal references across ${files} source files)`,
);

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".next-dev", ".git"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) inspect(path);
  }
}

function inspect(file) {
  files++;
  const text = readFileSync(file, "utf8");
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']((?:\.{1,2}\/|@\/)[^"']+)["']/gu,
    /import\(\s*["']((?:\.{1,2}\/|@\/)[^"']+)["']\s*\)/gu,
    /require\(\s*["']((?:\.{1,2}\/|@\/)[^"']+)["']\s*\)/gu,
  ];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1].split(/[?#]/u, 1)[0];
      const key = `${match.index}:${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references++;
      const resolved = resolveSpecifier(dirname(file), specifier);
      if (!resolved) {
        failures.push(`${relative(root, file)}: unresolved internal import ${specifier}`);
        continue;
      }
      if (!hasExactCase(resolved)) {
        failures.push(
          `${relative(root, file)}: import casing does not match filesystem: ${specifier}`,
        );
      }
    }
  }
}

function resolveSpecifier(base, specifier) {
  const basePath = specifier.startsWith(srcAliasPrefix)
    ? resolve(root, "src", specifier.slice(srcAliasPrefix.length))
    : resolve(base, specifier);
  for (const suffix of resolutionExtensions) {
    const candidate = `${basePath}${suffix}`;
    if (isFile(candidate)) return candidate;
  }
  for (const suffix of resolutionExtensions.slice(1)) {
    const candidate = join(basePath, `index${suffix}`);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function hasExactCase(path) {
  const absolute = resolve(path);
  if (!isAbsolute(absolute)) return false;
  const parsedRoot = parse(absolute).root;
  const parts = absolute.slice(parsedRoot.length).split(sep).filter(Boolean);
  let current = parsedRoot;
  for (const part of parts) {
    let names;
    try {
      names = readdirSync(current);
    } catch {
      return false;
    }
    if (!names.includes(part)) return false;
    current = join(current, part);
  }
  return true;
}
