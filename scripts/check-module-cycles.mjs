#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (/\.(ts|tsx|mts|mjs)$/.test(path)) yield path;
  }
}
const files = new Set();
for (const sourceRoot of ["src", "scripts"]) {
  try {
    for (const file of walk(join(ROOT, sourceRoot))) files.add(resolve(file));
  } catch {}
}
const extensions = [".ts", ".tsx", ".mts", ".mjs", ".js"];
function resolveLocal(from, specifier) {
  if (!(specifier.startsWith(".") || specifier.startsWith("@/"))) return null;
  const base = specifier.startsWith("@/")
    ? join(ROOT, "src", specifier.slice(2))
    : resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [
        ...extensions.map((extension) => `${base}${extension}`),
        ...extensions.map((extension) => join(base, `index${extension}`)),
      ];
  return (
    candidates
      .map((candidate) => resolve(candidate))
      .find((candidate) => files.has(candidate) && existsSync(candidate)) ?? null
  );
}
const graph = new Map();
const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
for (const file of files) {
  const targets = [];
  for (const match of readFileSync(file, "utf8").matchAll(importPattern)) {
    const target = resolveLocal(file, match[1]);
    if (target) targets.push(target);
  }
  graph.set(file, targets);
}
const state = new Map();
const stack = [];
const reported = new Set();
const cycles = [];
function visit(file) {
  state.set(file, 1);
  stack.push(file);
  for (const target of graph.get(file) ?? []) {
    const targetState = state.get(target) ?? 0;
    if (targetState === 0) visit(target);
    else if (targetState === 1) {
      const start = stack.lastIndexOf(target);
      const cycle = [...stack.slice(start), target].map((entry) =>
        relative(ROOT, entry).split(sep).join("/"),
      );
      const key = [...new Set(cycle.slice(0, -1))].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        cycles.push(cycle.join(" -> "));
      }
    }
  }
  stack.pop();
  state.set(file, 2);
}
for (const file of files) if (!state.has(file)) visit(file);
if (cycles.length) {
  console.error(
    `module-cycle contract failed (${cycles.length} cycle${cycles.length === 1 ? "" : "s"}):`,
  );
  for (const cycle of cycles) console.error(`- ${cycle}`);
  process.exit(1);
}
console.log(`module-cycle contract ok (${files.size} modules)`);
