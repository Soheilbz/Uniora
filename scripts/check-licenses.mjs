import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT AND ISC",
  "MIT License",
  "MPL-2.0",
  "OFL-1.1",
]);

const result = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
let report;
let usedFallback = false;

if (result.status === 0) {
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("pnpm licenses returned invalid JSON");
    process.exit(1);
  }
} else if (/ERR_PNPM_MISSING_PACKAGE_INDEX_FILE/.test(`${result.stdout}\n${result.stderr}`)) {
  report = readInstalledProductionLicenses();
  usedFallback = true;
} else {
  console.error(result.stderr || result.stdout || "pnpm licenses failed");
  process.exit(result.status || 1);
}

const violations = [];
for (const [license, packages] of Object.entries(report)) {
  if (allowed.has(license)) continue;
  for (const entry of packages ?? []) {
    violations.push(`${entry.name}@${entry.versions?.join(",")}:${license}`);
  }
}
if (violations.length) {
  console.error("unsupported production dependency licenses:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(
  `production license scan ok (${Object.values(report).flat().length} packages${usedFallback ? "; installed-graph fallback" : ""})`,
);

function readInstalledProductionLicenses() {
  const listed = spawnSync("pnpm", ["list", "--prod", "--json", "--depth", "Infinity"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    console.error(listed.stderr || listed.stdout || "pnpm production graph listing failed");
    process.exit(listed.status || 1);
  }

  let roots;
  try {
    roots = JSON.parse(listed.stdout);
  } catch {
    console.error("pnpm production graph listing returned invalid JSON");
    process.exit(1);
  }

  const packages = new Map();
  const visited = new Set();
  for (const root of roots) visit(root);

  const fallback = {};
  for (const entry of packages.values()) {
    const packageJsonPath = join(entry.path, "package.json");
    let packageJson;
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    } catch (error) {
      throw new Error(
        `production package metadata is unreadable for ${entry.name}: ${error.message}`,
      );
    }

    const license = normalizeLicense(packageJson.license ?? packageJson.licenses);
    if (!license) {
      throw new Error(`production package ${entry.name}@${entry.version} has no license metadata`);
    }
    if (!fallback[license]) fallback[license] = [];
    const existing = fallback[license].find((item) => item.name === entry.name);
    if (existing) {
      if (!existing.versions.includes(entry.version)) existing.versions.push(entry.version);
    } else {
      fallback[license].push({ name: entry.name, versions: [entry.version] });
    }
  }
  return fallback;

  function visit(node) {
    for (const group of ["dependencies", "optionalDependencies"]) {
      for (const [name, dependency] of Object.entries(node[group] ?? {})) {
        if (dependency.path && existsSync(join(dependency.path, "package.json"))) {
          if (!visited.has(dependency.path)) {
            visited.add(dependency.path);
            packages.set(dependency.path, {
              name: dependency.name ?? name,
              version: dependency.version ?? "unknown",
              path: dependency.path,
            });
          }
        }
        visit(dependency);
      }
    }
  }
}

function normalizeLicense(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const types = value
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter(Boolean);
    return types.length ? types.join(" AND ") : "";
  }
  if (value && typeof value === "object" && typeof value.type === "string")
    return value.type.trim();
  return "";
}
