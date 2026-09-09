import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
function gitOutput(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const gitFiles = gitOutput(["ls-files"]);
const tracked = gitFiles === null ? sourceFiles(root) : gitFiles.split(/\r?\n/).filter(Boolean);

/* High-confidence formats only: CI/test passwords and documented placeholders
 * are intentionally allowed, while provider-issued tokens and private keys
 * are never acceptable in source or a release artifact. */
const patterns = [
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
];

const findings = [];
for (const relative of tracked) {
  const path = `${root}/${relative}`;
  let stat;
  try {
    stat = statSync(path);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) continue;
  const content = readFileSync(path);
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    findings.push(`${relative}:${line}`);
  }
}

/* Scan every existing commit too. The command's output is discarded so a
 * finding never echoes the secret value into CI logs. */
const gitCommits = gitFiles === null ? null : gitOutput(["rev-list", "--all"]);
const commits = gitCommits?.split(/\r?\n/).filter(Boolean) ?? [];
for (const pattern of patterns) {
  if (!commits.length) break;
  const result = spawnSync("git", ["grep", "-nE", pattern.source, ...commits, "--"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status === 0 && result.stdout.trim()) findings.push(`git-history:${pattern.source}`);
}

if (findings.length) {
  for (const finding of [...new Set(findings)]) console.error(`secret pattern found: ${finding}`);
  process.exit(1);
}
const fileLabel = gitFiles === null ? "source files" : "tracked files";
const historyLabel =
  gitCommits === null ? "git history unavailable" : `${commits.length} commits scanned`;
console.log(`secret scan ok (${tracked.length} ${fileLabel}; ${historyLabel})`);

function sourceFiles(directory) {
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    ".next-dev",
    ".runtime-closures",
    ".univ",
    "node_modules",
    "playwright-report",
    "test-results",
  ]);
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
    }
  }
  walk(directory);
  return files;
}
