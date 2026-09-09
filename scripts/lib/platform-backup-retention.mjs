import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { backupHealthSummary, inspectBackupSet } from "./backup-format.ts";

export function applyBackupRetention({ policy, localDir, offsiteDir, keyring }) {
  if (!policy) return;
  const { daily, weekly, monthly } = policy;
  const set = inspectBackupSet(localDir, offsiteDir ? resolve(offsiteDir) : null, keyring);
  if (set.degraded) {
    throw new Error(
      `backup retention refused while catalog is degraded (${JSON.stringify(backupHealthSummary(set))})`,
    );
  }
  const entries = set.local.healthy.map((entry) => ({
    name: entry.manifest,
    archive: entry.archive,
    date: new Date(entry.createdAt),
  }));
  entries.sort((left, right) => right.date - left.date || right.name.localeCompare(left.name));
  const keep = new Set();
  keepBuckets(entries, daily, (entry) => entry.date.toISOString().slice(0, 10), keep);
  keepBuckets(entries, weekly, (entry) => isoWeek(entry.date), keep);
  keepBuckets(entries, monthly, (entry) => entry.date.toISOString().slice(0, 7), keep);
  if (entries[0]) keep.add(entries[0].name);
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    removeBackupPair(localDir, entry);
    if (offsiteDir) removeBackupPair(resolve(offsiteDir), entry);
  }
}

function keepBuckets(entries, limit, keyOf, keep) {
  if (limit <= 0) return;
  const seen = new Set();
  for (const entry of entries) {
    const bucket = keyOf(entry);
    if (seen.has(bucket) || seen.size >= limit) continue;
    seen.add(bucket);
    keep.add(entry.name);
  }
}

function isoWeek(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value - yearStart) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function removeBackupPair(base, entry) {
  rmSync(join(base, entry.archive), { force: true });
  rmSync(join(base, entry.name), { force: true });
}
