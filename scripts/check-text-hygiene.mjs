#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".css",
  ".sql",
  ".sh",
  ".toml",
  ".conf",
  ".example",
  ".txt",
]);
const explicitNames = new Set([
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".node-version",
  ".nvmrc",
]);
const excludedDirectories = new Set([
  ".git",
  ".next",
  ".next-dev",
  ".next-release",
  ".univ",
  ".runtime-closures",
  "node_modules",
  "toolchain",
]);
const failures = [];

walk(root);
if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("text hygiene ok (no hidden controls, CRLF or trailing whitespace)");

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    /* Playwright keeps screenshots, traces and error-context files under a
       per-run directory. They are disposable evidence, not source text, and
       may contain browser-generated whitespace that this source gate must not
       treat as a release defect. */
    if (entry.isDirectory() && directory === join(root, "e2e") && entry.name.startsWith(".run-"))
      continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!explicitNames.has(entry.name) && !extensions.has(extname(entry.name))) continue;
    const bytes = readFileSync(full);
    if (bytes.includes(0)) continue; // binary despite extension: ignore rather than decode corruptly
    const text = bytes.toString("utf8");
    const rel = relative(root, full).split(sep).join("/");
    if (/\r\n/.test(text))
      failures.push(`${rel}: CRLF line endings are not allowed in the Linux source baseline`);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: this checker must detect control characters.
    const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.exec(text);
    if (control)
      failures.push(
        `${rel}: hidden control character U+${control[0].charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (/[ \t]+$/.test(lines[index])) {
        failures.push(`${rel}:${index + 1}: trailing whitespace`);
        break;
      }
    }
  }
}
