import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const MANIFEST_SUFFIX = ".dump.enc.json";
const ARCHIVE_SUFFIX = ".dump.enc";

export type BackupKeyring = { activeId: string; keys: Map<string, Buffer> };
type BackupManifestBase = {
  createdAt: string;
  sourceDatabase: string;
  sourceTarget: string;
  algorithm: "aes-256-gcm";
  file: string;
  iv: string;
  tag: string;
  sha256: string;
  size: number;
  manifestHmac: string;
  [key: string]: unknown;
};
export type BackupManifest =
  | (BackupManifestBase & { version: 4; keyId?: never })
  | (BackupManifestBase & { version: 5; keyId: string });
export type HealthyBackupEntry = {
  manifest: string;
  archive: string;
  createdAt: string;
  createdAtMs: number;
  size: number;
  keyId: string;
  meta: BackupManifest;
};
export type InvalidBackupEntry = {
  manifest: string | null;
  archive: string | null;
  reason: string;
};
export type BackupDirectoryInspection = {
  directory: string;
  healthy: HealthyBackupEntry[];
  invalid: InvalidBackupEntry[];
  orphanArchives: string[];
};
export type BackupSetInspection = {
  local: BackupDirectoryInspection;
  offsite: BackupDirectoryInspection | null;
  missingOffsite: Array<{ manifest: string; archive: string }>;
  degraded: boolean;
};

export function backupKeyringFromEnvironment(env: NodeJS.ProcessEnv = process.env): BackupKeyring {
  const keys = new Map<string, Buffer>();
  const raw = env.BACKUP_ENCRYPTION_KEYS?.trim();
  const legacy = env.BACKUP_ENCRYPTION_KEY?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("BACKUP_ENCRYPTION_KEYS must be a JSON object of keyId -> 64-hex-key");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("BACKUP_ENCRYPTION_KEYS must be a JSON object of keyId -> 64-hex-key");
    }
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        !/^[A-Za-z0-9._-]{1,40}$/.test(id) ||
        typeof value !== "string" ||
        !/^[0-9a-fA-F]{64}$/.test(value)
      ) {
        throw new Error(`invalid backup key entry ${id}`);
      }
      keys.set(id, Buffer.from(value, "hex"));
    }
  }
  if (legacy) {
    if (!/^[0-9a-fA-F]{64}$/.test(legacy)) {
      throw new Error("BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    }
    if (!keys.has("legacy")) keys.set("legacy", Buffer.from(legacy, "hex"));
  }
  if (keys.size === 0) {
    throw new Error("BACKUP_ENCRYPTION_KEYS or BACKUP_ENCRYPTION_KEY is required");
  }
  const activeId = env.BACKUP_ACTIVE_KEY_ID?.trim() || (raw ? "" : "legacy");
  if (!activeId || !keys.has(activeId)) {
    throw new Error("BACKUP_ACTIVE_KEY_ID must name a key in BACKUP_ENCRYPTION_KEYS");
  }
  return { activeId, keys };
}

export function validateBackupManifest(meta: unknown): BackupManifest {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("invalid backup manifest");
  }
  const record = meta as Record<string, unknown>;
  if (![4, 5].includes(Number(record.version)) || record.algorithm !== "aes-256-gcm") {
    throw new Error("unsupported backup manifest");
  }
  if (
    record.version === 5 &&
    (typeof record.keyId !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(record.keyId))
  ) {
    throw new Error("invalid backup key id");
  }
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    throw new Error("invalid backup timestamp");
  }
  if (
    typeof record.sourceDatabase !== "string" ||
    record.sourceDatabase.length < 1 ||
    record.sourceDatabase.length > 63
  ) {
    throw new Error("invalid source database");
  }
  if (
    typeof record.sourceTarget !== "string" ||
    record.sourceTarget.length < 1 ||
    record.sourceTarget.length > 512
  ) {
    throw new Error("invalid source target");
  }
  if (typeof record.file !== "string" || !/^[A-Za-z0-9._-]+\.dump\.enc$/.test(record.file)) {
    throw new Error("invalid backup filename");
  }
  if (record.file !== basename(record.file)) throw new Error("manifest file must be a basename");
  if (typeof record.iv !== "string" || !/^[0-9a-f]{24}$/i.test(record.iv)) {
    throw new Error("invalid backup IV");
  }
  if (typeof record.tag !== "string" || !/^[0-9a-f]{32}$/i.test(record.tag)) {
    throw new Error("invalid backup auth tag");
  }
  if (typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(record.sha256)) {
    throw new Error("invalid backup checksum");
  }
  if (!Number.isSafeInteger(record.size) || Number(record.size) <= 0) {
    throw new Error("invalid backup size");
  }
  if (typeof record.manifestHmac !== "string" || !/^[0-9a-f]{64}$/i.test(record.manifestHmac)) {
    throw new Error("invalid backup manifest authentication");
  }
  return record as BackupManifest;
}

export function manifestPayload(meta: BackupManifest): string {
  const base = [
    meta.version,
    ...(meta.version === 5 ? [meta.keyId] : []),
    meta.createdAt,
    meta.sourceDatabase,
    meta.sourceTarget,
    meta.algorithm,
    meta.iv,
    meta.tag,
    meta.sha256,
    meta.size,
    meta.file,
  ];
  return JSON.stringify(base);
}

export function manifestHmac(meta: BackupManifest, key: Buffer): string {
  const domain = meta.version === 5 ? "univ-web-backup-manifest-v5" : "univ-web-backup-manifest-v4";
  const macKey = createHmac("sha256", key).update(domain).digest();
  return createHmac("sha256", macKey).update(manifestPayload(meta)).digest("hex");
}

function hmacMatches(meta: BackupManifest, key: Buffer): boolean {
  const expected = Buffer.from(manifestHmac(meta, key), "hex");
  const supplied = Buffer.from(meta.manifestHmac, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function verifyManifestHmac(meta: BackupManifest, keyring: BackupKeyring): Buffer {
  if (meta.version === 5) {
    const key = keyring.keys.get(meta.keyId);
    if (!key) throw new Error(`backup references unavailable key id ${meta.keyId}`);
    if (!hmacMatches(meta, key)) throw new Error("backup manifest authentication failed");
    return key;
  }
  for (const key of keyring.keys.values()) {
    if (hmacMatches(meta, key)) return key;
  }
  throw new Error("backup manifest authentication failed");
}

export function loadBackupManifest(
  inputPath: string,
  keyring: BackupKeyring,
): { manifestPath: string; meta: BackupManifest; archivePath: string; key: Buffer } {
  const manifestPath = resolve(inputPath);
  if (!existsSync(manifestPath)) throw new Error("manifest not found");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("backup manifest is not valid JSON");
  }
  const meta = validateBackupManifest(parsed);
  if (basename(manifestPath) !== `${meta.file}.json`) {
    throw new Error("backup manifest filename does not match its archive");
  }
  const key = verifyManifestHmac(meta, keyring);
  const base = dirname(manifestPath);
  const archivePath = resolve(base, meta.file);
  if (dirname(archivePath) !== base) throw new Error("manifest file escapes its directory");
  if (!existsSync(archivePath)) throw new Error("encrypted backup not found");
  const stat = statSync(archivePath);
  if (!stat.isFile()) throw new Error("encrypted backup is not a regular file");
  if (stat.size !== meta.size) throw new Error("backup size mismatch");
  return { manifestPath, meta, archivePath, key };
}

export function inspectBackupDirectory(
  baseDir: string,
  keyring: BackupKeyring,
): BackupDirectoryInspection {
  const directory = resolve(baseDir);
  const healthy: HealthyBackupEntry[] = [];
  const invalid: InvalidBackupEntry[] = [];
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    return {
      directory,
      healthy,
      invalid: [
        {
          manifest: null,
          archive: null,
          reason: `backup directory unavailable: ${message(error)}`,
        },
      ],
      orphanArchives: [],
    };
  }

  const manifestNames = names.filter((value) => value.endsWith(MANIFEST_SUFFIX)).slice(0, 10000);
  const claimedArchives = new Set(manifestNames.map((name) => name.slice(0, -".json".length)));
  for (const name of manifestNames) {
    const manifestPath = join(directory, name);
    try {
      const loaded = loadBackupManifest(manifestPath, keyring);
      if (sha256FileSync(loaded.archivePath) !== loaded.meta.sha256) {
        throw new Error("backup checksum mismatch");
      }
      healthy.push({
        manifest: name,
        archive: loaded.meta.file,
        createdAt: new Date(loaded.meta.createdAt).toISOString(),
        createdAtMs: Date.parse(loaded.meta.createdAt),
        size: loaded.meta.size,
        keyId: loaded.meta.version === 5 ? loaded.meta.keyId : "legacy-v4",
        meta: loaded.meta,
      });
    } catch (error) {
      invalid.push({ manifest: name, archive: null, reason: message(error) });
    }
  }

  const orphanArchives = names
    .filter(
      (name) =>
        name.endsWith(ARCHIVE_SUFFIX) && !name.startsWith(".") && !claimedArchives.has(name),
    )
    .sort();
  for (const archive of orphanArchives) {
    invalid.push({
      manifest: null,
      archive,
      reason: "encrypted archive has no committed manifest",
    });
  }

  healthy.sort(
    (left, right) =>
      right.createdAtMs - left.createdAtMs || right.manifest.localeCompare(left.manifest),
  );
  return { directory, healthy, invalid, orphanArchives };
}

export function inspectBackupSet(
  localDir: string,
  offsiteDir: string | null,
  keyring: BackupKeyring,
): BackupSetInspection {
  const local = inspectBackupDirectory(localDir, keyring);
  if (!offsiteDir) {
    return { local, offsite: null, missingOffsite: [], degraded: local.invalid.length > 0 };
  }
  const offsite = inspectBackupDirectory(offsiteDir, keyring);
  const offsitePairs = new Set(
    offsite.healthy.map((entry) => `${entry.manifest}\u0000${entry.archive}`),
  );
  const missingOffsite = local.healthy
    .filter((entry) => !offsitePairs.has(`${entry.manifest}\u0000${entry.archive}`))
    .map((entry) => ({ manifest: entry.manifest, archive: entry.archive }));
  return {
    local,
    offsite,
    missingOffsite,
    degraded: local.invalid.length > 0 || offsite.invalid.length > 0 || missingOffsite.length > 0,
  };
}

export function backupHealthSummary(set: BackupSetInspection): {
  localHealthy: number;
  localInvalid: number;
  offsiteConfigured: boolean;
  offsiteHealthy: number;
  offsiteInvalid: number;
  missingOffsite: number;
  degraded: boolean;
} {
  return {
    localHealthy: set.local.healthy.length,
    localInvalid: set.local.invalid.length,
    offsiteConfigured: Boolean(set.offsite),
    offsiteHealthy: set.offsite?.healthy.length ?? 0,
    offsiteInvalid: set.offsite?.invalid.length ?? 0,
    missingOffsite: set.missingOffsite.length,
    degraded: set.degraded,
  };
}

function sha256FileSync(file: string): string {
  const hash = createHash("sha256");
  const fd = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
export function pendingBackupPath(finalPath: string): string {
  return `${finalPath}.pending-${process.pid}-${randomBytes(6).toString("hex")}`;
}

/**
 * Publish an archive+manifest pair with the manifest as the commit marker.
 * A partially published archive is removed if the manifest cannot be committed.
 */
export function publishBackupPair(
  archiveTemp: string,
  archiveFinal: string,
  manifestTemp: string,
  manifestFinal: string,
): void {
  if (existsSync(archiveFinal) || existsSync(manifestFinal)) {
    throw new Error("backup generation already exists");
  }
  let archivePublished = false;
  try {
    renameSync(archiveTemp, archiveFinal);
    archivePublished = true;
    renameSync(manifestTemp, manifestFinal);
  } catch (error) {
    rmSync(archiveTemp, { force: true });
    rmSync(manifestTemp, { force: true });
    if (archivePublished && !existsSync(manifestFinal)) rmSync(archiveFinal, { force: true });
    throw error;
  }
}

/** Copy-on-write publication to an off-site filesystem directory. */
export function mirrorBackupPair(archive: string, manifest: string, mirrorDirectory: string): void {
  mkdirSync(mirrorDirectory, { recursive: true, mode: 0o700 });
  const archiveFinal = join(mirrorDirectory, basename(archive));
  const manifestFinal = join(mirrorDirectory, basename(manifest));
  if (existsSync(archiveFinal) || existsSync(manifestFinal)) {
    throw new Error("off-site backup generation already exists");
  }
  const archiveTemp = pendingBackupPath(archiveFinal);
  const manifestTemp = pendingBackupPath(manifestFinal);
  let archivePublished = false;
  try {
    copyFileSync(archive, archiveTemp);
    copyFileSync(manifest, manifestTemp);
    chmodSync(archiveTemp, 0o600);
    chmodSync(manifestTemp, 0o600);
    renameSync(archiveTemp, archiveFinal);
    archivePublished = true;
    renameSync(manifestTemp, manifestFinal);
  } catch (error) {
    rmSync(archiveTemp, { force: true });
    rmSync(manifestTemp, { force: true });
    if (archivePublished && !existsSync(manifestFinal)) rmSync(archiveFinal, { force: true });
    throw error;
  }
}
