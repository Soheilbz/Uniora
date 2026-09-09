import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/capabilities.ts";

/** Record an explicit data-egress event before returning a downloadable file. */
export async function auditDataExport(
  viewer: Viewer,
  entityType: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await withTenant(viewer.tenantId, (tx) =>
    writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      subjectId: viewer.userId,
      action: "data.export",
      entityType,
      changes: details ? JSON.stringify(details) : null,
      outcome: "success",
      source: "web",
    }),
  );
}
