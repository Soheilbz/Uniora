#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
const policy = JSON.parse(await readFile("drizzle/migration-safety.json", "utf8"));
const tracked = journal.entries.filter((entry) => entry.idx >= 33);
const failures = [];
for (const entry of tracked) {
  const item = policy.migrations?.[entry.tag];
  if (!item) {
    failures.push(`${entry.tag}: missing migration-safety metadata`);
    continue;
  }
  for (const key of ["additive", "estimatedLockRisk", "backwardCompatible", "notes", "rollback"])
    if (item[key] === undefined || item[key] === "") failures.push(`${entry.tag}: missing ${key}`);
  if (!["low", "medium", "high"].includes(item.estimatedLockRisk))
    failures.push(`${entry.tag}: invalid estimatedLockRisk`);
}
if (failures.length) {
  for (const f of failures) console.error(`error: ${f}`);
  process.exit(1);
}
console.log(`migration safety metadata ok (${tracked.length} tracked migrations)`);
