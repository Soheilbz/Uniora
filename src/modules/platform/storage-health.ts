import { randomUUID } from "node:crypto";
import { S3CompatibleStorage } from "@/lib/storage/s3-compatible.ts";

export type StorageCapabilityState = "pass" | "fail" | "not-tested";
export type StorageCapabilities = Record<
  "put" | "head" | "get" | "delete" | "presignedGet" | "presignedPut",
  StorageCapabilityState
>;

const notTested: StorageCapabilities = {
  put: "not-tested",
  head: "not-tested",
  get: "not-tested",
  delete: "not-tested",
  presignedGet: "not-tested",
  presignedPut: "not-tested",
};

export type ObjectStorageHealth = {
  status: "verified" | "unconfigured" | "unreachable" | "partial";
  provider: "s3-compatible" | "unconfigured";
  checkedAt: Date | null;
  capabilities: StorageCapabilities;
};

const PROBE_TTL_MS = 60_000;
let cachedProbe: { expiresAt: number; result: ObjectStorageHealth } | null = null;
let activeProbe: Promise<ObjectStorageHealth> | null = null;

function copyHealth(result: ObjectStorageHealth): ObjectStorageHealth {
  return { ...result, capabilities: { ...result.capabilities } };
}

/** Probe the complete object-storage contract; configuration alone is never green. */
export async function readObjectStorageHealth(): Promise<ObjectStorageHealth> {
  const now = Date.now();
  if (cachedProbe && cachedProbe.expiresAt > now) return copyHealth(cachedProbe.result);
  if (activeProbe) return copyHealth(await activeProbe);
  activeProbe = probeObjectStorageHealth();
  try {
    const result = await activeProbe;
    if (result.status !== "unconfigured") {
      cachedProbe = { expiresAt: Date.now() + PROBE_TTL_MS, result: copyHealth(result) };
    }
    return copyHealth(result);
  } finally {
    activeProbe = null;
  }
}

async function probeObjectStorageHealth(): Promise<ObjectStorageHealth> {
  const configured = Boolean(
    process.env.OBJECT_STORAGE_ENDPOINT?.trim() &&
      process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT?.trim() &&
      process.env.OBJECT_STORAGE_BROWSER_ORIGIN?.trim() &&
      process.env.OBJECT_STORAGE_BUCKET?.trim() &&
      process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() &&
      process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim(),
  );
  if (!configured) {
    return {
      status: "unconfigured",
      provider: "unconfigured",
      checkedAt: null,
      capabilities: { ...notTested },
    };
  }

  const checkedAt = new Date();
  const capabilities = { ...notTested };
  const key = `.platform/health/${randomUUID()}.probe`;
  const body = new TextEncoder().encode(`univ-platform-storage-probe:${randomUUID()}`);
  let storage: S3CompatibleStorage | null = null;
  try {
    storage = S3CompatibleStorage.fromEnvironment();
    await storage.put(key, body, "application/octet-stream");
    capabilities.put = "pass";
    try {
      if (!(await storage.head(key))) throw new Error("probe object was not found after PUT");
      capabilities.head = "pass";
    } catch {
      capabilities.head = "fail";
    }
    try {
      const read = await storage.get(key);
      if (Buffer.compare(Buffer.from(read), Buffer.from(body)) !== 0)
        throw new Error("probe body mismatch");
      capabilities.get = "pass";
    } catch {
      capabilities.get = "fail";
    }
    try {
      const url = await storage.signedGetUrl(key, 60);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`presigned GET failed (${response.status})`);
      capabilities.presignedGet = "pass";
    } catch {
      capabilities.presignedGet = "fail";
    }
    try {
      const url = await storage.signedPutUrl(key, "application/octet-stream", 60);
      if (new URL(url).protocol !== "https:" && process.env.NODE_ENV === "production")
        throw new Error("presigned PUT URL is not HTTPS");
      capabilities.presignedPut = "pass";
    } catch {
      capabilities.presignedPut = "fail";
    }
  } catch {
    capabilities.put = "fail";
  } finally {
    if (storage) {
      try {
        await storage.delete(key);
        capabilities.delete = "pass";
      } catch {
        capabilities.delete = "fail";
      }
    }
  }
  const passCount = Object.values(capabilities).filter((value) => value === "pass").length;
  return {
    status:
      passCount === Object.keys(capabilities).length
        ? "verified"
        : passCount > 0
          ? "partial"
          : "unreachable",
    provider: "s3-compatible",
    checkedAt,
    capabilities,
  };
}
