#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import {
  backupHealthSummary,
  backupKeyringFromEnvironment,
  inspectBackupSet,
} from "./lib/backup-format.ts";

const command = process.argv[2] || "status";
const connectionString = process.env.DATABASE_ADMIN_URL?.trim();
const backupDir = resolve(process.env.BACKUP_DIR?.trim() || "./backups");
const offsiteDir = process.env.BACKUP_OFFSITE_DIR?.trim()
  ? resolve(process.env.BACKUP_OFFSITE_DIR.trim())
  : null;
const reportDir = resolve(process.env.DR_REPORT_DIR?.trim() || "./.dr-reports");
const targetRpoMinutes = boundedInt(
  "DR_TARGET_RPO_MINUTES",
  process.env.DR_TARGET_RPO_MINUTES,
  1440,
  1,
  525600,
);
const targetRtoMinutes = boundedInt(
  "DR_TARGET_RTO_MINUTES",
  process.env.DR_TARGET_RTO_MINUTES,
  240,
  1,
  10080,
);

if (command === "record-drill") {
  const rpoMinutes = measuredMinutes(process.argv[3], "measured RPO");
  const rtoMinutes = measuredMinutes(process.argv[4], "measured RTO");
  await mkdir(reportDir, { recursive: true });
  const report = {
    recordedAt: new Date().toISOString(),
    rpoMinutes,
    rtoMinutes,
    targetRpoMinutes,
    targetRtoMinutes,
    rpoMet: rpoMinutes <= targetRpoMinutes,
    rtoMet: rtoMinutes <= targetRtoMinutes,
  };
  const path = resolve(reportDir, `dr-drill-${new Date().toISOString().replaceAll(":", "-")}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(path);
  process.exit(0);
}

if (command !== "status") {
  throw new Error(
    "usage: dr-readiness.mjs status | record-drill <measured-rpo-minutes> <measured-rto-minutes>",
  );
}
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required for DR status");

const backupRing = backupKeyringFromEnvironment();
const backupSet = inspectBackupSet(backupDir, offsiteDir, backupRing);
const backup = backupSet.local.healthy[0] ?? null;
const ageMinutes = backup ? Math.round((Date.now() - backup.createdAtMs) / 60000) : null;
const catalog = backupHealthSummary(backupSet);

const pool = new pg.Pool({ connectionString, application_name: "univ-dr-readiness", max: 1 });
const client = await pool.connect();
try {
  const settings = await client.query(
    `select current_setting('wal_level') wal_level,current_setting('archive_mode') archive_mode,current_setting('archive_command') archive_command,current_setting('max_wal_senders')::int max_wal_senders,pg_is_in_recovery() in_recovery,pg_current_wal_lsn()::text current_wal_lsn`,
  );
  const slots = await client.query(
    `select slot_name,slot_type,active,restart_lsn::text from pg_replication_slots order by slot_name`,
  );
  const row = settings.rows[0] ?? {};
  const archiveConfigured =
    row.archive_mode === "on" &&
    typeof row.archive_command === "string" &&
    row.archive_command.trim() &&
    row.archive_command.trim() !== "(disabled)";
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targets: { rpoMinutes: targetRpoMinutes, rtoMinutes: targetRtoMinutes },
        postgres: row,
        replicationSlots: slots.rows,
        backup: {
          manifest: backup?.manifest ?? null,
          createdAt: backup?.createdAt ?? null,
          ageMinutes,
          rpoWithinTarget: ageMinutes !== null && ageMinutes <= targetRpoMinutes,
          catalog,
        },
        pitr: {
          walLevelSuitable: ["replica", "logical"].includes(String(row.wal_level)),
          archiveMode: String(row.archive_mode),
          archiveCommandConfigured: Boolean(archiveConfigured),
        },
        warnings: [
          ...(backup ? [] : ["no authenticated local backup found"]),
          ...(catalog.degraded
            ? [
                "backup catalog is degraded; inspect backup operational health before retention or restore",
              ]
            : []),
          ...(catalog.localInvalid
            ? [`${catalog.localInvalid} invalid local backup artifact(s) detected`]
            : []),
          ...(catalog.offsiteInvalid
            ? [`${catalog.offsiteInvalid} invalid off-site backup artifact(s) detected`]
            : []),
          ...(catalog.missingOffsite
            ? [`${catalog.missingOffsite} local backup generation(s) are missing off-site`]
            : []),
          ...(ageMinutes !== null && ageMinutes > targetRpoMinutes
            ? [`backup age ${ageMinutes}m exceeds RPO target ${targetRpoMinutes}m`]
            : []),
          ...(!archiveConfigured
            ? [
                "WAL archive_command is not configured; service-level PITR requires external WAL archival or managed database PITR",
              ]
            : []),
        ],
      },
      null,
      2,
    ),
  );
} finally {
  client.release();
  await pool.end();
}

function boundedInt(name, raw, fallback, min, max) {
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function measuredMinutes(raw, label) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      "usage: dr-readiness.mjs record-drill <measured-rpo-minutes> <measured-rto-minutes>",
    );
  }
  if (value > 5256000) throw new Error(`${label} is implausibly large`);
  return value;
}
