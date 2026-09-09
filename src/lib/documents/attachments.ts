import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { attachments } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEventCore } from "@/lib/audit-writer-core.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";
import { enqueueTenantJobInTx } from "@/lib/jobs/enqueue.ts";
import { objectStorage, tenantQuarantineObjectKey } from "@/lib/storage/object-storage.ts";
import { enqueueStorageReconcileInTx } from "@/lib/storage/reconciliation.ts";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function isAllowedAttachmentMime(mimeType: string): boolean {
  return ALLOWED_MIME.has(mimeType);
}

export async function prepareAttachmentUpload(input: {
  tenantId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  classification?: "public" | "internal" | "confidential" | "restricted";
}) {
  if (!isAllowedAttachmentMime(input.mimeType)) throw new Error("unsupported attachment type");
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error("attachment size is outside the allowed range");
  }

  const attachmentId = randomUUID();
  const objectKey = tenantQuarantineObjectKey({
    tenantId: input.tenantId,
    entityType: input.entityType,
    entityId: input.entityId,
    attachmentId,
    filename: input.filename,
  });

  await withTenant(input.tenantId, async (tx) => {
    await tx.insert(attachments).values({
      id: attachmentId,
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      objectKey,
      filename: input.filename.slice(0, 255),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: input.actorId,
      classification: input.classification ?? "internal",
      status: "quarantine",
    });
    await enqueueStorageReconcileInTx(tx, {
      tenantId: input.tenantId,
      requestedBy: input.actorId,
      resourceType: "attachment",
      resourceId: attachmentId,
      policy: "expiry",
      candidateKeys: [objectKey],
      entityType: input.entityType,
      entityId: input.entityId,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      maxAttempts: 20,
    });
    await appendDomainEvent(tx, input.tenantId, {
      type: "AttachmentUploadPrepared",
      aggregateType: input.entityType,
      aggregateId: input.entityId,
      payload: { attachmentId },
    });
    await writeAuditEventCore(tx, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "attachment.upload.prepare",
      entityType: "attachment",
      entityId: attachmentId,
      changes: JSON.stringify({
        entityType: input.entityType,
        entityId: input.entityId,
        filename: input.filename.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        classification: input.classification ?? "internal",
      }),
    });
  });

  try {
    return {
      attachmentId,
      objectKey,
      uploadUrl: await objectStorage().signedPutUrl(objectKey, input.mimeType, 300),
    };
  } catch (error) {
    await withTenant(input.tenantId, async (tx) => {
      await tx
        .update(attachments)
        .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(attachments.id, attachmentId), eq(attachments.status, "quarantine")));
      await enqueueStorageReconcileInTx(tx, {
        tenantId: input.tenantId,
        requestedBy: input.actorId,
        resourceType: "attachment",
        resourceId: attachmentId,
        policy: "cleanup-candidates",
        candidateKeys: [objectKey],
        entityType: input.entityType,
        entityId: input.entityId,
        maxAttempts: 12,
      });
    }).catch(() => undefined);
    throw error;
  }
}

/**
 * Completes the browser-writable quarantine phase without holding a database
 * transaction open while object-store I/O is in flight. The content type is a
 * signed upload header and is also verified from authoritative object metadata.
 */
export async function completeAttachmentUpload(input: {
  tenantId: string;
  actorId: string;
  attachmentId: string;
}) {
  const prepared = await withTenant(input.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: attachments.id,
        objectKey: attachments.objectKey,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        uploadedBy: attachments.uploadedBy,
        status: attachments.status,
        deletedAt: attachments.deletedAt,
      })
      .from(attachments)
      .where(and(eq(attachments.tenantId, input.tenantId), eq(attachments.id, input.attachmentId)))
      .limit(1);

    if (!row || row.deletedAt) throw new Error("attachment not found");
    if (row.uploadedBy !== input.actorId)
      throw new Error("only the uploader can complete this upload");
    return row;
  });

  if (prepared.status !== "quarantine") return { status: prepared.status };
  if (!prepared.objectKey.includes("/quarantine/"))
    throw new Error("attachment is not in the upload quarantine namespace");

  const head = await objectStorage().head(prepared.objectKey);
  if (
    !head ||
    head.size !== prepared.sizeBytes ||
    normalizedMediaType(head.contentType) !== prepared.mimeType.toLowerCase()
  ) {
    throw new Error("uploaded object metadata does not match the prepared upload");
  }

  return withTenant(input.tenantId, async (tx) => {
    const [claimed] = await tx
      .update(attachments)
      .set({ status: "scanning", updatedAt: new Date() })
      .where(
        and(
          eq(attachments.tenantId, input.tenantId),
          eq(attachments.id, input.attachmentId),
          eq(attachments.uploadedBy, input.actorId),
          eq(attachments.status, "quarantine"),
          eq(attachments.objectKey, prepared.objectKey),
        ),
      )
      .returning({ id: attachments.id, status: attachments.status });

    if (!claimed) {
      const [current] = await tx
        .select({ status: attachments.status })
        .from(attachments)
        .where(
          and(eq(attachments.tenantId, input.tenantId), eq(attachments.id, input.attachmentId)),
        )
        .limit(1);
      if (!current) throw new Error("attachment not found");
      return { status: current.status };
    }

    await enqueueTenantJobInTx(tx, {
      tenantId: input.tenantId,
      requestedBy: input.actorId,
      kind: "documents.scan",
      payload: { attachmentId: claimed.id },
      dedupeKey: `scan:${claimed.id}`,
    });
    await writeAuditEventCore(tx, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "attachment.upload.complete",
      entityType: "attachment",
      entityId: claimed.id,
      changes: JSON.stringify({ status: "scanning", scanJobQueued: true }),
    });
    return { status: "scanning" as const };
  });
}

function normalizedMediaType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
