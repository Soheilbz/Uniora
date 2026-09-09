import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { attachments, user } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import {
  canReadDocumentEntity,
  type DocumentEntityType,
  readableDocumentEntityTypes,
} from "@/lib/documents/access.ts";

export async function readManagedAttachments(
  viewer: Viewer,
  filter?: { entityType: DocumentEntityType; entityId: string } | null,
  limit = 200,
) {
  const allowed = readableDocumentEntityTypes(viewer);
  if (allowed.length === 0) return [];
  if (filter && !canReadDocumentEntity(viewer, filter.entityType)) return [];

  return readOnly(viewer.tenantId, (tx) =>
    tx
      .select({
        id: attachments.id,
        entityType: attachments.entityType,
        entityId: attachments.entityId,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        sha256: attachments.sha256,
        classification: attachments.classification,
        status: attachments.status,
        version: attachments.version,
        uploadedAt: attachments.createdAt,
        uploaderName: user.name,
        finalizedVersion: sql<
          number | null
        >`(select max(dv.version_no) from document_versions dv where dv.tenant_id = ${attachments.tenantId} and dv.document_type = ('attachment:' || ${attachments.entityType}) and dv.document_id = ${attachments.id}::text and dv.status in ('finalized','superseded'))`,
        signed: sql<boolean>`exists(select 1 from document_versions dv where dv.tenant_id = ${attachments.tenantId} and dv.document_type = ('attachment:' || ${attachments.entityType}) and dv.document_id = ${attachments.id}::text and dv.signature_reference is not null)`,
      })
      .from(attachments)
      .leftJoin(
        user,
        and(eq(user.tenantId, attachments.tenantId), eq(user.id, attachments.uploadedBy)),
      )
      .where(
        and(
          isNull(attachments.deletedAt),
          inArray(attachments.entityType, allowed),
          filter ? eq(attachments.entityType, filter.entityType) : undefined,
          filter ? eq(attachments.entityId, filter.entityId) : undefined,
        ),
      )
      .orderBy(desc(attachments.createdAt), desc(attachments.id))
      .limit(Math.min(Math.max(limit, 1), 500)),
  );
}

export async function readAttachmentUploadContext(tenantId: string, attachmentId: string) {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: attachments.id,
        entityType: attachments.entityType,
        entityId: attachments.entityId,
        uploadedBy: attachments.uploadedBy,
        status: attachments.status,
        deletedAt: attachments.deletedAt,
      })
      .from(attachments)
      .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, attachmentId)))
      .limit(1),
  );
  return row ?? null;
}

/** Internal metadata needed to finalize an available attachment. Object bytes are read outside DB transactions. */
export async function readAttachmentFinalizationContext(tenantId: string, attachmentId: string) {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: attachments.id,
        entityType: attachments.entityType,
        entityId: attachments.entityId,
        objectKey: attachments.objectKey,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        sha256: attachments.sha256,
        classification: attachments.classification,
        status: attachments.status,
        uploadedBy: attachments.uploadedBy,
        deletedAt: attachments.deletedAt,
      })
      .from(attachments)
      .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, attachmentId)))
      .limit(1),
  );
  return row ?? null;
}
