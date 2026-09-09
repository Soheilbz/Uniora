import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { importBatches, importMappingProfiles, jobs, workshops } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { enqueueTenantJobInTx, jobDedupeKey } from "@/lib/jobs/enqueue.ts";
import {
  objectStorage,
  tenantLargeImportPromotedObjectKey,
  tenantLargeImportQuarantineObjectKey,
} from "@/lib/storage/object-storage.ts";
import { enqueueStorageReconcileInTx } from "@/lib/storage/reconciliation.ts";
import type { Viewer } from "@/lib/viewer.ts";
import {
  type ParticipantImportConflictPolicy,
  type ParticipantImportMapping,
  parseParticipantImportMappingJson,
} from "./import-model.ts";

export const LARGE_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const BATCH_RETENTION_DAYS = 7;

export interface LargeImportBatchView {
  id: string;
  workshopId: string;
  filename: string;
  sizeBytes: number;
  status: string;
  processedRows: number;
  totalRows: number | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  faultCount: number;
  publicError: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

export async function listLargeImportBatches(tenantId: string): Promise<LargeImportBatchView[]> {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: importBatches.id,
        workshopId: importBatches.workshopId,
        filename: importBatches.filename,
        sizeBytes: importBatches.sizeBytes,
        status: importBatches.status,
        processedRows: importBatches.processedRows,
        totalRows: importBatches.totalRows,
        createdCount: importBatches.createdCount,
        updatedCount: importBatches.updatedCount,
        skippedCount: importBatches.skippedCount,
        faultCount: importBatches.faultCount,
        publicError: importBatches.publicError,
        createdAt: importBatches.createdAt,
        completedAt: importBatches.completedAt,
        expiresAt: importBatches.expiresAt,
      })
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt))
      .limit(40),
  );
}

export async function prepareLargeParticipantImport(
  viewer: Viewer,
  input: {
    workshopId: string;
    filename: string;
    sizeBytes: number;
    profileId?: string | null;
    conflictPolicy?: ParticipantImportConflictPolicy;
  },
): Promise<{ batchId: string; uploadUrl: string }> {
  if (!isUuid(input.workshopId)) throw new Error("invalid workshop");
  const filename = input.filename.trim();
  if (!/\.csv$/i.test(filename) || filename.length > 255)
    throw new Error("only CSV files are supported");
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > LARGE_IMPORT_MAX_BYTES
  )
    throw new Error("invalid import size");
  const conflictPolicy: ParticipantImportConflictPolicy =
    input.conflictPolicy === "update" ? "update" : "skip";
  const batchId = randomUUID();
  const objectKey = tenantLargeImportQuarantineObjectKey({
    tenantId: viewer.tenantId,
    batchId,
    filename,
  });
  const expiresAt = new Date(Date.now() + BATCH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let mapping: ParticipantImportMapping = {};

  await withTenant(viewer.tenantId, async (tx) => {
    const [workshop] = await tx
      .select({ id: workshops.id })
      .from(workshops)
      .where(and(eq(workshops.id, input.workshopId), isNull(workshops.deletedAt)))
      .limit(1);
    if (!workshop) throw new Error("workshop was not found");
    if (input.profileId && isUuid(input.profileId)) {
      const [profile] = await tx
        .select({ mappingJson: importMappingProfiles.mappingJson })
        .from(importMappingProfiles)
        .where(
          and(
            eq(importMappingProfiles.id, input.profileId),
            eq(importMappingProfiles.entityType, "workshop_participant"),
            isNull(importMappingProfiles.deletedAt),
          ),
        )
        .limit(1);
      if (!profile) throw new Error("mapping profile was not found");
      try {
        mapping = parseParticipantImportMappingJson(profile.mappingJson);
      } catch {
        throw new Error("mapping profile is invalid");
      }
    }
    await tx.insert(importBatches).values({
      id: batchId,
      tenantId: viewer.tenantId,
      workshopId: input.workshopId,
      requestedBy: viewer.userId,
      objectKey,
      filename,
      sizeBytes: input.sizeBytes,
      mappingJson: JSON.stringify(mapping),
      conflictPolicy,
      status: "uploading",
      expiresAt,
    });
    await enqueueStorageReconcileInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      resourceType: "import-batch",
      resourceId: batchId,
      policy: "expiry",
      candidateKeys: [objectKey],
      scheduledAt: expiresAt,
      maxAttempts: 20,
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "import.large.prepare",
      entityType: "import_batch",
      entityId: batchId,
      changes: JSON.stringify({
        workshopId: input.workshopId,
        filename,
        sizeBytes: input.sizeBytes,
        profileId: input.profileId ?? null,
        conflictPolicy,
      }),
    });
  });

  try {
    return {
      batchId,
      uploadUrl: await objectStorage().signedPutUrl(objectKey, "text/csv", UPLOAD_URL_TTL_SECONDS),
    };
  } catch (error) {
    await withTenant(viewer.tenantId, async (tx) => {
      await tx
        .update(importBatches)
        .set({
          status: "cancelled",
          publicError: "Object storage upload could not be prepared.",
          updatedAt: new Date(),
        })
        .where(eq(importBatches.id, batchId));
      await enqueueStorageReconcileInTx(tx, {
        tenantId: viewer.tenantId,
        requestedBy: viewer.userId,
        resourceType: "import-batch",
        resourceId: batchId,
        policy: "cleanup-candidates",
        candidateKeys: [objectKey],
        maxAttempts: 12,
      });
    }).catch(() => undefined);
    throw error;
  }
}

export async function completeLargeParticipantImport(
  viewer: Viewer,
  batchId: string,
): Promise<{ jobId: string; deduplicated: boolean }> {
  if (!isUuid(batchId)) throw new Error("invalid import batch");
  const context = await readOnly(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: importBatches.id,
        objectKey: importBatches.objectKey,
        filename: importBatches.filename,
        sizeBytes: importBatches.sizeBytes,
        status: importBatches.status,
        requestedBy: importBatches.requestedBy,
        expiresAt: importBatches.expiresAt,
      })
      .from(importBatches)
      .where(eq(importBatches.id, batchId))
      .limit(1);
    return row ?? null;
  });
  if (!context || context.requestedBy !== viewer.userId || context.status !== "uploading")
    throw new Error("import batch is not ready to complete");
  const storage = objectStorage();
  const head = await storage.head(context.objectKey);
  if (!head || head.size !== context.sizeBytes)
    throw new Error("uploaded object size does not match the prepared import");
  if (!head.etag || head.etag.length > 200) throw new Error("uploaded object has no stable ETag");
  if (!/^text\/csv(?:;|$)/i.test(head.contentType ?? ""))
    throw new Error("uploaded object is not a CSV file");

  // Copy exactly the entity validated above into a fresh server-only key. The
  // conditional source ETag closes the HEAD/GET/HEAD ABA race: if the browser
  // overwrites quarantine before promotion, CopyObject fails instead of copying
  // different bytes. A still-valid browser PUT can only recreate quarantine and
  // can never address the promoted key used by the durable job.
  const promotedKey = tenantLargeImportPromotedObjectKey({
    tenantId: viewer.tenantId,
    batchId,
    filename: context.filename,
    promotionId: randomUUID(),
  });
  await withTenant(viewer.tenantId, (tx) =>
    enqueueStorageReconcileInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      resourceType: "import-batch",
      resourceId: batchId,
      policy: "orphan-only",
      candidateKeys: [promotedKey],
      scheduledAt: context.expiresAt,
      maxAttempts: 20,
    }),
  );
  await storage.copyIfMatch(context.objectKey, promotedKey, head.etag);

  // The pre-registered orphan reconciler owns cleanup of promotedKey. Keeping
  // object deletion out of this failure path makes crash recovery durable.
  const promotedHead = await storage.head(promotedKey);
  if (!promotedHead || promotedHead.size !== context.sizeBytes) {
    throw new Error("promoted import object size does not match the prepared import");
  }
  if (!promotedHead.etag || promotedHead.etag.length > 200) {
    throw new Error("promoted import object has no stable ETag");
  }
  if (!/^text\/csv(?:;|$)/i.test(promotedHead.contentType ?? "")) {
    throw new Error("promoted import object lost its CSV content type");
  }

  const result = await withTenant(viewer.tenantId, async (tx) => {
    const [claimed] = await tx
      .update(importBatches)
      .set({
        objectKey: promotedKey,
        status: "queued",
        publicError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.status, "uploading"),
          eq(importBatches.requestedBy, viewer.userId),
          eq(importBatches.objectKey, context.objectKey),
        ),
      )
      .returning({ id: importBatches.id });
    if (!claimed) throw new Error("import batch changed before it could be queued");

    const payload = { batchId, expectedEtag: promotedHead.etag };
    const job = await enqueueTenantJobInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      kind: "workshop.participants.import.large",
      payload,
      dedupeKey: jobDedupeKey("workshop.participants.import.large", payload),
      maxAttempts: 6,
    });
    await tx
      .update(importBatches)
      .set({ jobId: job.id, updatedAt: new Date() })
      .where(eq(importBatches.id, batchId));
    await enqueueStorageReconcileInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      resourceType: "import-batch",
      resourceId: batchId,
      policy: "cleanup-candidates",
      candidateKeys: [context.objectKey],
      maxAttempts: 12,
    });
    await enqueueStorageReconcileInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      resourceType: "import-batch",
      resourceId: batchId,
      policy: "expiry",
      candidateKeys: [promotedKey],
      scheduledAt: context.expiresAt,
      maxAttempts: 20,
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "import.large.queue",
      entityType: "import_batch",
      entityId: batchId,
      changes: JSON.stringify({ jobId: job.id, deduplicated: job.deduplicated, promoted: true }),
    });
    return { jobId: job.id, deduplicated: job.deduplicated };
  });

  return result;
}

export async function cancelLargeParticipantImport(
  viewer: Viewer,
  batchId: string,
): Promise<boolean> {
  if (!isUuid(batchId)) return false;
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(importBatches)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(importBatches.id, batchId),
          eq(importBatches.requestedBy, viewer.userId),
          inArray(importBatches.status, ["uploading", "queued"]),
        ),
      )
      .returning({
        id: importBatches.id,
        objectKey: importBatches.objectKey,
        jobId: importBatches.jobId,
      });
    if (!row) return false;
    if (row.jobId) {
      await tx
        .update(jobs)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          leaseUntil: null,
          publicError: null,
          privateError: null,
          errorCode: null,
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, row.jobId), inArray(jobs.status, ["queued", "retry"])));
    }
    await enqueueStorageReconcileInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      resourceType: "import-batch",
      resourceId: batchId,
      policy: "cleanup-candidates",
      candidateKeys: [row.objectKey],
      maxAttempts: 12,
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "import.large.cancel",
      entityType: "import_batch",
      entityId: batchId,
    });
    return true;
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
