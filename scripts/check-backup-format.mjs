import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupKeyringFromEnvironment,
  inspectBackupDirectory,
  loadBackupManifest,
  manifestHmac,
  mirrorBackupPair,
  pendingBackupPath,
  publishBackupPair,
} from "./lib/backup-format.ts";

const root = mkdtempSync(join(tmpdir(), "univ-backup-contract-"));
const local = join(root, "local");
const offsite = join(root, "offsite");
mkdirSync(local);
mkdirSync(offsite);

try {
  const keyring = backupKeyringFromEnvironment({
    BACKUP_ENCRYPTION_KEYS: JSON.stringify({ primary: "11".repeat(32) }),
    BACKUP_ACTIVE_KEY_ID: "primary",
  });
  const key = keyring.keys.get("primary");
  if (!key) throw new Error("test keyring did not expose the active key");

  const archiveName = "univ-web-contract.dump.enc";
  const manifestName = `${archiveName}.json`;
  const archive = join(local, archiveName);
  const manifest = join(local, manifestName);
  const archivePending = pendingBackupPath(archive);
  const manifestPending = pendingBackupPath(manifest);
  const bytes = Buffer.from("encrypted-contract-payload");
  writeFileSync(archivePending, bytes);

  const meta = {
    version: 5,
    keyId: "primary",
    createdAt: "2026-09-06T20:00:00.000Z",
    sourceDatabase: "univ",
    sourceTarget: "postgresql://localhost:5432/univ",
    algorithm: "aes-256-gcm",
    iv: "00".repeat(12),
    tag: "00".repeat(16),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    file: archiveName,
  };
  meta.manifestHmac = manifestHmac(meta, key);
  writeFileSync(manifestPending, JSON.stringify(meta));
  publishBackupPair(archivePending, archive, manifestPending, manifest);

  let catalog = inspectBackupDirectory(local, keyring);
  assert(catalog.healthy.length === 1 && catalog.invalid.length === 0, "healthy pair rejected");

  mirrorBackupPair(archive, manifest, offsite);
  const mirrored = inspectBackupDirectory(offsite, keyring);
  assert(mirrored.healthy.length === 1 && mirrored.invalid.length === 0, "off-site pair rejected");

  const corrupted = Buffer.from(bytes);
  corrupted[0] ^= 1;
  writeFileSync(archive, corrupted);
  catalog = inspectBackupDirectory(local, keyring);
  assert(
    catalog.healthy.length === 0 &&
      catalog.invalid.length === 1 &&
      catalog.invalid[0]?.reason === "backup checksum mismatch",
    "same-size archive corruption was not detected exactly once",
  );

  writeFileSync(join(local, "orphan.dump.enc"), "orphan");
  catalog = inspectBackupDirectory(local, keyring);
  assert(
    catalog.invalid.some((entry) => entry.reason === "encrypted archive has no committed manifest"),
    "orphan archive was not detected",
  );

  const alias = { ...meta, file: "other.dump.enc" };
  alias.manifestHmac = manifestHmac(alias, key);
  writeFileSync(manifest, JSON.stringify(alias));
  let aliasRejected = false;
  try {
    loadBackupManifest(manifest, keyring);
  } catch (error) {
    aliasRejected = message(error).includes("filename does not match");
  }
  assert(aliasRejected, "manifest/archive filename alias was accepted");

  console.log("backup format contract ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function assert(condition, text) {
  if (!condition) throw new Error(text);
}

function message(value) {
  return value instanceof Error ? value.message : String(value);
}
