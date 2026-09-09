import { S3CompatibleStorage } from "./s3-compatible.ts";

export type { ObjectStorage, StoredObjectHead } from "./storage-types.ts";

import type { ObjectStorage } from "./storage-types.ts";

let instance: ObjectStorage | null = null;

/**
 * Returns the only supported persistent binary-storage boundary.
 * Local disk is deliberately not a provider: it is unsafe under multi-instance
 * deployment and would make a successful upload depend on which Web node serves
 * the subsequent request.
 */
export function objectStorage(): ObjectStorage {
  if (instance) return instance;
  const provider = (process.env.OBJECT_STORAGE_PROVIDER ?? "s3").trim().toLowerCase();
  if (provider !== "s3" && provider !== "s3-compatible") {
    throw new Error(`Unsupported OBJECT_STORAGE_PROVIDER: ${provider}`);
  }
  instance = S3CompatibleStorage.fromEnvironment();
  return instance;
}

export function safeObjectKeyPart(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("object key segment is empty or unsafe");
  }
  return normalized.slice(0, 120);
}

interface LargeImportObjectKeyInput {
  tenantId: string;
  batchId: string;
  filename: string;
}

/** Browser-writable namespace used only until the upload is completed. */
export function tenantLargeImportQuarantineObjectKey(input: LargeImportObjectKeyInput): string {
  return [
    "tenant",
    safeObjectKeyPart(input.tenantId),
    "imports",
    "quarantine",
    safeObjectKeyPart(input.batchId),
    safeObjectKeyPart(input.filename),
  ].join("/");
}

/**
 * Server-only destination for a completed large import. `promotionId` is generated
 * after upload completion, so no browser-issued signed URL can address this key.
 */
export function tenantLargeImportPromotedObjectKey(
  input: LargeImportObjectKeyInput & { promotionId: string },
): string {
  return [
    "tenant",
    safeObjectKeyPart(input.tenantId),
    "imports",
    "objects",
    safeObjectKeyPart(input.batchId),
    safeObjectKeyPart(input.promotionId),
    safeObjectKeyPart(input.filename),
  ].join("/");
}

interface AttachmentObjectKeyInput {
  tenantId: string;
  entityType: string;
  entityId: string;
  attachmentId: string;
  filename: string;
}

/**
 * Client-writable upload namespace. Objects under this prefix are never served
 * as verified documents. A scanner must copy the exact verified bytes to the
 * promoted namespace before an attachment can become available.
 */
export function tenantQuarantineObjectKey(input: AttachmentObjectKeyInput): string {
  return attachmentKey(["quarantine"], input);
}

/**
 * Server-only immutable namespace for bytes that have already passed the
 * security boundary. Including the digest in the key makes promotion
 * content-addressed and prevents a still-valid quarantine PUT URL from
 * overwriting the downloadable object.
 */
export function tenantPromotedObjectKey(
  input: AttachmentObjectKeyInput & { sha256: string },
): string {
  const digest = input.sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("invalid SHA-256 for promoted object key");
  return attachmentKey(["objects", digest], input);
}

/**
 * Server-created document artifacts (for example provider-signed documents)
 * never pass through a browser-writable key, so they can be stored directly in
 * the server-only object namespace. Kept as the compatibility helper for
 * existing server-side callers.
 */
export function tenantObjectKey(input: AttachmentObjectKeyInput): string {
  return attachmentKey(["objects", "server"], input);
}

function attachmentKey(prefix: string[], input: AttachmentObjectKeyInput): string {
  return [
    "tenant",
    safeObjectKeyPart(input.tenantId),
    ...prefix,
    safeObjectKeyPart(input.entityType),
    safeObjectKeyPart(input.entityId),
    safeObjectKeyPart(input.attachmentId),
    safeObjectKeyPart(input.filename),
  ].join("/");
}
