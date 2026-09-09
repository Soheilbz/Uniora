import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = join(root, "src");
const allowedRawTables = new Set([
  "components/council/checklist-document.tsx",
  "components/council/minutes-document.tsx",
  "components/settings/print-document.tsx",
  "components/worksheets/sheet-blocks.tsx",
  "components/worksheets/sheet-rubric.tsx",
  "components/ui/table.tsx",
]);
const rawTables = [];

walk(sourceRoot);

if (rawTables.length > 0) {
  console.error("table-system contract failed: raw UI tables must use components/ui/table");
  for (const file of rawTables) console.error(`- ${file}`);
  process.exit(1);
}

console.log(
  `table-system contract ok (central primitive enforced; ${allowedRawTables.size} print/document table files allowlisted)`,
);

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const relativePath = relative(sourceRoot, path).replaceAll("\\", "/");
    if (allowedRawTables.has(relativePath)) continue;
    if (/<table\b|<thead\b|<tbody\b/.test(readFileSync(path, "utf8"))) rawTables.push(relativePath);
  }
}
