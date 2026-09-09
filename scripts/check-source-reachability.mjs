#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcRoot = join(root, "src");
const extensions = [".ts", ".tsx", ".mts", ".mjs", ".js"];
const productionFiles = new Set(
  [
    ...walk(join(root, "src")),
    ...walk(join(root, "scripts"), { excludeTests: true, excludeCheckers: true }),
  ].map((file) => resolve(file)),
);
const sourceFiles = [...productionFiles].filter((file) => file.startsWith(`${srcRoot}${sep}`));
const inbound = new Map(sourceFiles.map((file) => [file, 0]));
const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

for (const importer of productionFiles) {
  const source = readFileSync(importer, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const target = resolveSpecifier(importer, match[1]);
    if (target && inbound.has(target)) inbound.set(target, (inbound.get(target) ?? 0) + 1);
  }
}

const unreachable = [...inbound]
  .filter(([file, count]) => count === 0 && !isFrameworkEntrypoint(file))
  .map(([file]) => relative(root, file).split(sep).join("/"))
  .sort();

if (unreachable.length) {
  for (const file of unreachable)
    console.error(`error: ${file}: production source module has no production consumer`);
  process.exit(1);
}
console.log(`source reachability ok (${sourceFiles.length} production source modules)`);

function* walk(directory, { excludeTests = true, excludeCheckers = false } = {}) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".runtime-closures"].includes(entry.name)) continue;
      yield* walk(full, { excludeTests, excludeCheckers });
      continue;
    }
    if (!extensions.includes(extname(entry.name))) continue;
    if (excludeTests && /\.(?:test|spec)\.(?:ts|tsx|mts|mjs|js)$/.test(entry.name)) continue;
    if (excludeCheckers && /^check-.*\.mjs$/.test(entry.name)) continue;
    yield full;
  }
}

function resolveSpecifier(importer, specifier) {
  if (!(specifier.startsWith(".") || specifier.startsWith("@/"))) return null;
  const base = specifier.startsWith("@/")
    ? join(srcRoot, specifier.slice(2))
    : resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base, ...typedAlternatives(base)]
    : [
        ...extensions.map((extension) => `${base}${extension}`),
        ...extensions.map((extension) => join(base, `index${extension}`)),
      ];
  return (
    candidates
      .map((candidate) => resolve(candidate))
      .find((candidate) => productionFiles.has(candidate)) ?? null
  );
}

function typedAlternatives(base) {
  if (![".js", ".mjs"].includes(extname(base))) return [];
  const stem = base.slice(0, -extname(base).length);
  return [".ts", ".tsx", ".mts"].map((extension) => `${stem}${extension}`);
}

function isFrameworkEntrypoint(file) {
  const rel = relative(srcRoot, file).split(sep).join("/");
  const name = rel.split("/").at(-1) ?? "";
  if (
    rel.startsWith("app/") &&
    new Set([
      "page.tsx",
      "layout.tsx",
      "route.ts",
      "loading.tsx",
      "error.tsx",
      "global-error.tsx",
      "not-found.tsx",
      "template.tsx",
      "default.tsx",
    ]).has(name)
  )
    return true;
  return new Set(["instrumentation.ts", "proxy.ts", "i18n/request.ts"]).has(rel);
}
