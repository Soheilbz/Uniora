"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { attachments } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { canManageDocumentEntity, isDocumentEntityType } from "@/lib/documents/access.ts";
import {
  completeAttachmentUpload,
  isAllowedAttachmentMime,
  MAX_ATTACHMENT_BYTES,
  prepareAttachmentUpload,
} from "@/lib/documents/attachments.ts";
import { documentEntityExists, isDocumentEntityId } from "@/lib/documents/entities.ts";
import {
  finalizeDocumentVersion,
  type SignatureResult,
  sha256Bytes,
} from "@/lib/documents/finalization.ts";
import { resolveDocumentSigningProvider } from "@/lib/documents/signing.ts";
import { objectStorage, tenantObjectKey } from "@/lib/storage/object-storage.ts";
import { enqueueStorageReconcileInTx } from "@/lib/storage/reconciliation.ts";
import { requireCapability } from "@/lib/viewer.ts";
import {
  readAttachmentFinalizationContext,
  readAttachmentUploadContext,
} from "@/modules/documents/queries.ts";

export type PrepareUploadResult =
  | { ok: true; attachmentId: string; uploadUrl: string }
  | { ok: false; error: "invalid" | "forbidden" | "not_found" | "storage" };

export async function prepareManagedAttachment(input: {
  entityType: string;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  classification: string;
}): Promise<PrepareUploadResult> {
  const viewer = await requireCapability("documents.manage");
  const entityId = input.entityId.trim();

  if (!isDocumentEntityType(input.entityType) || !isDocumentEntityId(entityId)) {
    return { ok: false, error: "invalid" };
  }
  if (!canManageDocumentEntity(viewer, input.entityType)) {
    return { ok: false, error: "forbidden" };
  }
  if (
    !input.filename.trim() ||
    !isAllowedAttachmentMime(input.mimeType) ||
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > MAX_ATTACHMENT_BYTES
  ) {
    return { ok: false, error: "invalid" };
  }
  if (!(await documentEntityExists(viewer.tenantId, input.entityType, entityId))) {
    return { ok: false, error: "not_found" };
  }

  const classification = ["public", "internal", "confidential", "restricted"].includes(
    input.classification,
  )
    ? (input.classification as "public" | "internal" | "confidential" | "restricted")
    : "internal";

  try {
    const prepared = await prepareAttachmentUpload({
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      entityType: input.entityType,
      entityId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      classification,
    });
    return { ok: true, attachmentId: prepared.attachmentId, uploadUrl: prepared.uploadUrl };
  } catch {
    return { ok: false, error: "storage" };
  }
}

export async function completeManagedAttachment(input: {
  entityType: string;
  entityId: string;
  attachmentId: string;
}): Promise<{ ok: boolean }> {
  const viewer = await requireCapability("documents.manage");
  const entityId = input.entityId.trim();

  if (
    !isDocumentEntityType(input.entityType) ||
    !isDocumentEntityId(entityId) ||
    !canManageDocumentEntity(viewer, input.entityType)
  ) {
    return { ok: false };
  }

  const prepared = await readAttachmentUploadContext(viewer.tenantId, input.attachmentId);
  if (
    !prepared ||
    prepared.deletedAt ||
    prepared.uploadedBy !== viewer.userId ||
    prepared.entityType !== input.entityType ||
    prepared.entityId !== entityId
  ) {
    return { ok: false };
  }

  await completeAttachmentUpload({
    tenantId: viewer.tenantId,
    actorId: viewer.userId,
    attachmentId: input.attachmentId,
  });
  revalidatePath("/documents");
  revalidatePath(`/documents?entityType=${input.entityType}&entityId=${entityId}`);
  return { ok: true };
}

export async function finalizeManagedAttachmentAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("documents.manage");
  const attachmentId = String(form.get("attachmentId") ?? "");
  const sign = String(form.get("sign") ?? "") === "true";
  const reason =
    String(form.get("reason") ?? "")
      .trim()
      .slice(0, 500) || null;
  const context = await readAttachmentFinalizationContext(viewer.tenantId, attachmentId);
  if (!context || context.deletedAt || context.status !== "available" || !context.sha256) return;
  if (
    !isDocumentEntityType(context.entityType) ||
    !canManageDocumentEntity(viewer, context.entityType)
  )
    return;
  if (!(await documentEntityExists(viewer.tenantId, context.entityType, context.entityId))) return;

  const sourceBytes = await objectStorage().get(context.objectKey);
  if (sourceBytes.byteLength !== context.sizeBytes || sha256Bytes(sourceBytes) !== context.sha256) {
    throw new Error("document bytes no longer match the verified attachment metadata");
  }

  let finalAttachmentId = context.id;
  let finalDigest = context.sha256;
  let signature: SignatureResult | null = null;
  let createdObjectKey: string | null = null;
  let createdAttachmentId: string | null = null;
  let createdSizeBytes: number | null = null;

  if (sign) {
    const provider = await resolveDocumentSigningProvider(viewer.tenantId);
    if (!provider) throw new Error("no active document signing provider is configured");
    signature = await provider.sign({
      tenantId: viewer.tenantId,
      documentType: `attachment:${context.entityType}`,
      documentId: context.id,
      content: sourceBytes,
      sha256: context.sha256,
      mimeType: context.mimeType,
    });
    if (!signature.signedContent && signature.contentSha256 !== context.sha256) {
      throw new Error("detached signature provider returned a mismatched content digest");
    }
    if (signature.signedContent) {
      const signedBytes = signature.signedContent;
      const signedMimeType =
        signature.signedMimeType === "application/pdf" ? "application/pdf" : context.mimeType;
      const signedDigest = sha256Bytes(signedBytes);
      const signedId = randomUUID();
      const signedName = `signed-${context.filename}`.slice(0, 255);
      const objectKey = tenantObjectKey({
        tenantId: viewer.tenantId,
        entityType: context.entityType,
        entityId: context.entityId,
        attachmentId: signedId,
        filename: signedName,
      });
      // Register orphan cleanup before the object-store side effect. If the PUT
      // succeeds but the following domain transaction does not commit, the
      // reconciler deletes the unreachable signed artifact. A committed
      // attachment protects the same key and the job becomes a no-op.
      await withTenant(viewer.tenantId, (tx) =>
        enqueueStorageReconcileInTx(tx, {
          tenantId: viewer.tenantId,
          requestedBy: viewer.userId,
          resourceType: "attachment",
          resourceId: signedId,
          policy: "orphan-only",
          candidateKeys: [objectKey],
          entityType: context.entityType,
          entityId: context.entityId,
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          maxAttempts: 20,
        }),
      );
      await objectStorage().put(objectKey, signedBytes, signedMimeType);
      createdObjectKey = objectKey;
      createdAttachmentId = signedId;
      finalAttachmentId = signedId;
      finalDigest = signedDigest;
      createdSizeBytes = signedBytes.byteLength;
      signature = { ...signature, contentSha256: signedDigest, signedMimeType };
    }
  }

  // createdObjectKey has a pre-registered durable orphan reconciler.
  await withTenant(viewer.tenantId, async (tx) => {
    if (createdAttachmentId && createdObjectKey) {
      await tx.insert(attachments).values({
        id: createdAttachmentId,
        tenantId: viewer.tenantId,
        entityType: context.entityType,
        entityId: context.entityId,
        objectKey: createdObjectKey,
        filename: `signed-${context.filename}`.slice(0, 255),
        mimeType: signature?.signedMimeType ?? context.mimeType,
        sizeBytes: createdSizeBytes ?? 0,
        sha256: finalDigest,
        uploadedBy: viewer.userId,
        classification: context.classification,
        status: "available",
        scanProvider: `signing:${signature?.provider ?? "provider"}`,
        scanResult: "signed artifact",
        scannedAt: new Date(),
        availableAt: new Date(),
      });
    }
    await finalizeDocumentVersion(tx, {
      tenantId: viewer.tenantId,
      documentType: `attachment:${context.entityType}`,
      documentId: context.id,
      actorId: viewer.userId,
      contentSha256: finalDigest,
      attachmentId: finalAttachmentId,
      reason,
      signature,
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: sign ? "document.finalize_sign" : "document.finalize",
      entityType: context.entityType,
      entityId: context.entityId,
      changes: JSON.stringify({
        sourceAttachmentId: context.id,
        finalAttachmentId,
        sha256: finalDigest,
        signed: Boolean(signature),
        signatureProvider: signature?.provider ?? null,
      }),
    });
  });
  revalidatePath("/documents");
}
