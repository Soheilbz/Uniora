/**
 * Platform backup/restore utility. Runs only in an operator shell/job, never in
 * Next.js. PostgreSQL custom archives are verified, encrypted with AES-256-GCM,
 * checksummed, retained by generation and optionally mirrored off-host.
 */

import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import {
  backupHealthSummary,
  backupKeyringFromEnvironment,
  inspectBackupSet,
  loadBackupManifest,
  manifestHmac,
  mirrorBackupPair,
  pendingBackupPath,
  publishBackupPair,
} from "./lib/backup-format.ts";
import {
  boundedInt,
  fail,
  message,
  option,
  postgresBinary,
  postgresEnvironment,
  requireFile,
} from "./lib/platform-backup-cli.mjs";
import {
  assertRestoredPlatformPrivilegeContract,
  assertRestoredWebPrivilegeContract,
  assertRestoredWorkerPrivilegeContract,
  assertRestoreTargetRolesExist,
} from "./lib/platform-backup-restore-contract.mjs";
import { prepareRestoreList } from "./lib/platform-backup-restore-list.mjs";
import { applyBackupRetention } from "./lib/platform-backup-retention.mjs";
import { platformRolePrivilegeSql } from "./lib/platform-role-policy.mjs";
import { webRolePrivilegeSql } from "./lib/web-role-policy.mjs";
import { workerRolePrivilegeSql } from "./lib/worker-role-policy.mjs";

const { Pool } = pg;
process.umask(0o077);
const [command, ...args] = process.argv.slice(2);
const databaseEnvironmentKey =
  command === "restore" ? "DATABASE_ADMIN_URL" : "DATABASE_PLATFORM_URL";
const url = process.env[databaseEnvironmentKey]?.trim();
const operator = process.env.PLATFORM_OPERATOR?.trim();
const dir = resolve(process.env.BACKUP_DIR?.trim() || "./backups");
const offsite = process.env.BACKUP_OFFSITE_DIR?.trim();
if (!url) fail(`${databaseEnvironmentKey} is required for backup ${command || "operation"}`);
if (!operator) fail("PLATFORM_OPERATOR is required");
const backupRing = backupKeyringFromEnvironment();
const retentionPolicy = ["create", "rekey"].includes(command)
  ? {
      daily: boundedInt("BACKUP_KEEP_DAILY", process.env.BACKUP_KEEP_DAILY, 14, 1, 365),
      weekly: boundedInt("BACKUP_KEEP_WEEKLY", process.env.BACKUP_KEEP_WEEKLY, 8, 0, 104),
      monthly: boundedInt("BACKUP_KEEP_MONTHLY", process.env.BACKUP_KEEP_MONTHLY, 12, 0, 120),
    }
  : null;
mkdirSync(dir, { recursive: true, mode: 0o700 });
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
const pgTarget = postgresEnvironment(url, databaseEnvironmentKey);

let lockClient;
try {
  lockClient = await pool.connect();
  const locked = await lockClient.query(
    `select pg_try_advisory_lock(hashtextextended($1, 0)) as locked`,
    ["univ-web:backup-admin"],
  );
  if (!locked.rows[0]?.locked) {
    throw new Error("another backup/restore operation is already running");
  }
  if (command === "create") await createBackup();
  else if (command === "verify") await verifyBackup(requireFile(args));
  else if (command === "rekey") await rekeyBackup(requireFile(args));
  else if (command === "restore") await restoreBackup(requireFile(args));
  else
    fail(
      `usage: platform-backup.mjs create | verify --file <manifest.json> | rekey --file <manifest.json> | restore --file <manifest.json> --confirm RESTORE:${pgTarget.database} [--confirm-source <source-target>]`,
    );
} finally {
  if (lockClient) {
    try {
      await lockClient.query(`select pg_advisory_unlock(hashtextextended($1, 0))`, [
        "univ-web:backup-admin",
      ]);
    } finally {
      lockClient.release();
    }
  }
  await pool.end();
}

async function createBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const plain = join(dir, `univ-web-${stamp}.dump`);
  const encrypted = `${plain}.enc`;
  const manifest = `${encrypted}.json`;
  const encryptedTemp = pendingBackupPath(encrypted);
  const manifestTemp = pendingBackupPath(manifest);
  let localVerified = false;
  let meta = null;
  try {
    run(
      postgresBinary("pg_dump"),
      ["--format=custom", "--no-owner", "--file", plain],
      "pg_dump failed",
    );
    run(
      postgresBinary("pg_restore"),
      ["--list", plain],
      "pg_dump produced an unreadable custom archive",
      "ignore",
    );

    const iv = randomBytes(12);
    const key = backupRing.keys.get(backupRing.activeId);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    await pipeline(
      createReadStream(plain),
      cipher,
      createWriteStream(encryptedTemp, { mode: 0o600, flags: "wx" }),
    );
    const tag = cipher.getAuthTag();
    rmSync(plain, { force: true });

    meta = {
      version: 5,
      keyId: backupRing.activeId,
      createdAt: new Date().toISOString(),
      sourceDatabase: pgTarget.database,
      sourceTarget: pgTarget.identity,
      algorithm: "aes-256-gcm",
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      sha256: await sha256(encryptedTemp),
      size: statSync(encryptedTemp).size,
      file: basename(encrypted),
    };
    meta.manifestHmac = manifestHmac(meta, key);
    writeFileSync(manifestTemp, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    publishBackupPair(encryptedTemp, encrypted, manifestTemp, manifest);

    // The manifest is the commit marker. Validate the committed local pair before
    // it is mirrored or older generations are considered for retention.
    await verifyEncryptedArtifact(manifest, false);
    localVerified = true;

    if (offsite) mirrorBackupPair(encrypted, manifest, resolve(offsite));
    await audit("backup.created", null, basename(encrypted), {
      sha256: meta.sha256,
      sourceDatabase: pgTarget.database,
      sourceTarget: pgTarget.identity,
      offsite: Boolean(offsite),
    });
    await applyRetentionSafely(basename(encrypted));
    await safePublishBackupHealth(meta, basename(manifest));
    console.log(manifest);
  } catch (error) {
    rmSync(plain, { force: true });
    rmSync(encryptedTemp, { force: true });
    rmSync(manifestTemp, { force: true });
    if (!localVerified) {
      rmSync(encrypted, { force: true });
      rmSync(manifest, { force: true });
    }
    await safePublishCurrentBackupHealth(meta, manifest ? basename(manifest) : null);
    await safeAudit("backup.create_failed", null, basename(encrypted), {
      error: message(error),
      localBackupPreserved: localVerified,
    });
    throw error;
  }
}

async function verifyBackup(manifestPath) {
  const verified = await verifyEncryptedArtifact(manifestPath, true);
  await safePublishBackupHealth(verified.meta, basename(resolve(manifestPath)));
  console.log("backup verified");
}

async function verifyEncryptedArtifact(manifestPath, verifyArchive) {
  const { meta, enc, key } = load(manifestPath);
  const sha = await sha256(enc);
  if (sha !== meta.sha256) throw new Error("backup checksum mismatch");
  if (statSync(enc).size !== meta.size) throw new Error("backup size mismatch");
  if (!verifyArchive) {
    await decryptToNull(enc, meta, key);
    return { meta, enc, sha, key };
  }
  const temp = join(dir, `.verify-${process.pid}-${randomBytes(6).toString("hex")}.dump`);
  try {
    await decrypt(enc, temp, meta, key);
    run(
      postgresBinary("pg_restore"),
      ["--list", temp],
      "backup is not a readable PostgreSQL custom archive",
      "ignore",
    );
    return { meta, enc, sha, key };
  } finally {
    rmSync(temp, { force: true });
  }
}

async function rekeyBackup(manifestPath) {
  const sourceManifest = resolve(manifestPath);
  if (dirname(sourceManifest) !== dir) {
    throw new Error("rekey requires a manifest from BACKUP_DIR");
  }
  const verified = await verifyEncryptedArtifact(sourceManifest, true);
  const { meta, enc, key: oldKey } = verified;
  if (meta.version === 5 && meta.keyId === backupRing.activeId) {
    console.log(sourceManifest);
    return;
  }

  const nextKey = backupRing.keys.get(backupRing.activeId);
  const generation = new Date().toISOString().replace(/[:.]/g, "-");
  const stem = enc.slice(0, -".dump.enc".length);
  const nextEnc = `${stem}.rekey-${generation}.dump.enc`;
  const nextManifest = `${nextEnc}.json`;
  const nextEncTemp = pendingBackupPath(nextEnc);
  const nextManifestTemp = pendingBackupPath(nextManifest);
  const iv = randomBytes(12);
  const decipher = createDecipheriv("aes-256-gcm", oldKey, Buffer.from(meta.iv, "hex"));
  decipher.setAuthTag(Buffer.from(meta.tag, "hex"));
  const cipher = createCipheriv("aes-256-gcm", nextKey, iv);
  let localPublished = false;
  let oldRetired = false;
  try {
    await pipeline(
      createReadStream(enc),
      decipher,
      cipher,
      createWriteStream(nextEncTemp, { mode: 0o600, flags: "wx" }),
    );
    const tag = cipher.getAuthTag();
    const next = {
      ...meta,
      version: 5,
      keyId: backupRing.activeId,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      sha256: await sha256(nextEncTemp),
      size: statSync(nextEncTemp).size,
      file: basename(nextEnc),
    };
    next.manifestHmac = manifestHmac(next, nextKey);
    writeFileSync(nextManifestTemp, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    publishBackupPair(nextEncTemp, nextEnc, nextManifestTemp, nextManifest);
    await verifyEncryptedArtifact(nextManifest, true);
    localPublished = true;

    if (offsite) mirrorBackupPair(nextEnc, nextManifest, resolve(offsite));

    // Retire the old generation only after the replacement exists locally and,
    // when configured, off-site. The manifest is the commit marker, so retire it
    // first; an interrupted archive deletion leaves only a detectable orphan.
    rmSync(sourceManifest, { force: true });
    oldRetired = true;
    rmSync(enc, { force: true });
    if (offsite) {
      rmSync(join(resolve(offsite), basename(sourceManifest)), { force: true });
      rmSync(join(resolve(offsite), basename(enc)), { force: true });
    }

    await audit("backup.rekeyed", null, basename(nextEnc), {
      fromKeyId: meta.version === 5 ? meta.keyId : "v4-unknown",
      toKeyId: backupRing.activeId,
      sha256: next.sha256,
      replaced: basename(enc),
    });
    await applyRetentionSafely(basename(nextEnc));
    await safePublishBackupHealth(next, basename(nextManifest));
    console.log(nextManifest);
  } catch (error) {
    rmSync(nextEncTemp, { force: true });
    rmSync(nextManifestTemp, { force: true });
    if (!oldRetired) {
      rmSync(nextManifest, { force: true });
      rmSync(nextEnc, { force: true });
      if (offsite && localPublished) {
        rmSync(join(resolve(offsite), basename(nextManifest)), { force: true });
        rmSync(join(resolve(offsite), basename(nextEnc)), { force: true });
      }
    }
    await safePublishCurrentBackupHealth(meta, basename(sourceManifest));
    await safeAudit("backup.rekey_failed", null, basename(enc), {
      error: message(error),
      replacementPublished: localPublished,
      oldGenerationRetired: oldRetired,
    });
    throw error;
  }
}

async function restoreBackup(manifestPath) {
  const expected = `RESTORE:${pgTarget.database}`;
  if (option(args, "--confirm") !== expected) fail(`restore requires --confirm ${expected}`);
  if (process.env.PLATFORM_RESTORE_ALLOWED !== "YES") {
    fail("restore requires PLATFORM_RESTORE_ALLOWED=YES in the operator environment");
  }
  /* The advisory-lock connection is already checked out above. Query through
   * that same session: using pool.query() here would borrow a second client,
   * and the safety count would falsely see the lock holder as an unrelated
   * database client, making every restore refuse itself. */
  const active = await lockClient.query(
    `select count(*)::int as n
       from pg_stat_activity
      where datname=current_database()
        and backend_type='client backend'
        and pid<>pg_backend_pid()`,
  );
  if (Number(active.rows[0]?.n ?? 0) > 0) {
    fail(
      "restore refused while other database clients are connected; stop the Web service and disconnect interactive/worker clients first",
    );
  }

  await assertRestoreTargetRolesExist(pool);
  const { meta, enc, sha, key } = await verifyEncryptedArtifact(manifestPath, true);
  if (meta.sourceTarget !== pgTarget.identity) {
    const crossConfirm = option(args, "--confirm-source");
    if (process.env.PLATFORM_CROSS_TARGET_RESTORE !== "YES" || crossConfirm !== meta.sourceTarget) {
      fail(
        `backup source target is ${meta.sourceTarget}; cross-target restore also requires ` +
          `PLATFORM_CROSS_TARGET_RESTORE=YES and --confirm-source ${meta.sourceTarget}`,
      );
    }
  }
  const temp = join(dir, `.restore-${process.pid}-${randomBytes(6).toString("hex")}.dump`);
  const restoreList = `${temp}.list`;
  try {
    await decrypt(enc, temp, meta, key);
    prepareRestoreList(postgresBinary("pg_restore"), temp, restoreList);
    run(
      postgresBinary("pg_restore"),
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--exit-on-error",
        "--single-transaction",
        "--use-list",
        restoreList,
        "--dbname",
        pgTarget.database,
        temp,
      ],
      "pg_restore failed",
    );
    // Database/schema ACLs are target-level state and are not fully carried by pg_dump.
    // Reapply the same fail-closed Web policy used by db:setup, without touching
    // the Web role password. This also makes old archives safe to recover.
    await pool.query(webRolePrivilegeSql(pgTarget.database));
    await pool.query(workerRolePrivilegeSql(pgTarget.database));
    await pool.query(platformRolePrivilegeSql(pgTarget.database));
    await assertRestoredWebPrivilegeContract(pool);
    await assertRestoredWorkerPrivilegeContract(pool);
    await assertRestoredPlatformPrivilegeContract(pool);
    await audit("backup.restored", null, basename(enc), {
      sha256: sha,
      sourceDatabase: meta.sourceDatabase,
      sourceTarget: meta.sourceTarget,
      targetDatabase: pgTarget.database,
      targetTarget: pgTarget.identity,
    });
    console.log("restore completed");
  } catch (error) {
    await safeAudit("backup.restore_failed", null, basename(enc), {
      error: message(error),
      sha256: sha,
      targetDatabase: pgTarget.database,
      targetTarget: pgTarget.identity,
    });
    throw error;
  } finally {
    rmSync(temp, { force: true });
    rmSync(restoreList, { force: true });
  }
}

function run(program, programArgs, errorMessage, stdio = "inherit") {
  const result = spawnSync(program, programArgs, { stdio, env: pgTarget.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(errorMessage);
}

function load(inputPath) {
  const loaded = loadBackupManifest(inputPath, backupRing);
  return { meta: loaded.meta, enc: loaded.archivePath, key: loaded.key };
}

async function decrypt(enc, out, meta, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(meta.iv, "hex"));
  decipher.setAuthTag(Buffer.from(meta.tag, "hex"));
  await pipeline(createReadStream(enc), decipher, createWriteStream(out, { mode: 0o600 }));
}
async function decryptToNull(enc, meta, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(meta.iv, "hex"));
  decipher.setAuthTag(Buffer.from(meta.tag, "hex"));
  for await (const _ of createReadStream(enc).pipe(decipher)) {
    // Authentication is verified when the stream reaches its end.
  }
}
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function audit(action, tenantId, target, changes) {
  await pool.query(
    `insert into platform_audit_log(operator,action,tenant_id,target,changes) values($1,$2,$3,$4,$5)`,
    [operator, action, tenantId, target, JSON.stringify(changes)],
  );
}
async function safeAudit(action, tenantId, target, changes) {
  try {
    await audit(action, tenantId, target, changes);
  } catch (error) {
    console.error(`warning: unable to write backup audit event (${action}): ${message(error)}`);
  }
}
async function safePublishBackupHealth(meta, manifestName) {
  await safePublishCurrentBackupHealth(meta, manifestName);
}

async function safePublishCurrentBackupHealth(meta = null, manifestName = null) {
  try {
    const set = inspectBackupSet(dir, offsite ? resolve(offsite) : null, backupRing);
    const entries = set.local.healthy;
    const latest = entries[0] ?? null;
    const offsitePairs = new Set(
      (set.offsite?.healthy ?? []).map((entry) => `${entry.manifest}\u0000${entry.archive}`),
    );
    const now = new Date().toISOString();
    const payload = {
      latestCreatedAt: latest?.createdAt ?? (meta?.createdAt ? String(meta.createdAt) : null),
      manifest: manifestName ? basename(manifestName) : (latest?.manifest ?? null),
      verifiedAt: now,
      retainedCount: entries.length,
      totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
      oldestCreatedAt: entries.at(-1)?.createdAt ?? null,
      catalog: backupHealthSummary(set),
      backups: entries.map((entry) => ({
        manifest: entry.manifest,
        createdAt: entry.createdAt,
        sizeBytes: entry.size,
        offsite: set.offsite ? offsitePairs.has(`${entry.manifest}\u0000${entry.archive}`) : false,
        metadataValid: true,
        lastVerifiedAt: entry.manifest === basename(manifestName ?? "") ? now : null,
      })),
    };
    await pool.query(
      `insert into platform_operational_health(key,status,payload_json,observed_at)
       values('backup',$1,$2,now())
       on conflict(key) do update set status=excluded.status,payload_json=excluded.payload_json,observed_at=excluded.observed_at`,
      [set.degraded ? "degraded" : "ok", JSON.stringify(payload)],
    );
  } catch (error) {
    console.error(`warning: unable to publish backup health: ${message(error)}`);
  }
}

async function applyRetentionSafely(target) {
  try {
    applyBackupRetention({
      policy: retentionPolicy,
      localDir: dir,
      offsiteDir: offsite ?? null,
      keyring: backupRing,
    });
    return true;
  } catch (error) {
    await safeAudit("backup.retention_skipped", null, target, { error: message(error) });
    console.error(`warning: backup retention skipped: ${message(error)}`);
    return false;
  }
}
