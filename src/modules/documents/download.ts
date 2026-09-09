import { and, eq, isNull } from "drizzle-orm";
import { attachments } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { canReadDocumentEntity, isDocumentEntityType } from "@/lib/documents/access.ts";
import type { Viewer } from "@/lib/viewer.ts";

export async function readManagedAttachmentDownload(viewer: Viewer, id: string) {
  const row = await readOnly(viewer.tenantId, async (tx) => {
    const [found] = await tx
      .select({
        entityType: attachments.entityType,
        objectKey: attachments.objectKey,
        status: attachments.status,
      })
      .from(attachments)
      .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)))
      .limit(1);
    return found ?? null;
  });
  if (
    row?.status !== "available" ||
    !isDocumentEntityType(row.entityType) ||
    !canReadDocumentEntity(viewer, row.entityType)
  )
    return null;
  return row;
}
