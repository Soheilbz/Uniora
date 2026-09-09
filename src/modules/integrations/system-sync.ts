import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  integrationConnections,
  integrationStagingRecords,
  integrationSyncRuns,
} from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { enqueueTenantJobInTx, jobDedupeKey } from "@/lib/jobs/enqueue.ts";
import type { Viewer } from "@/lib/viewer.ts";

export const SYSTEM_SYNC_KINDS = ["sis", "hr", "identity_ldap"] as const;
export type SystemSyncKind = (typeof SYSTEM_SYNC_KINDS)[number];

export async function listSystemSyncState(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    const connections = await tx
      .select({
        id: integrationConnections.id,
        kind: integrationConnections.kind,
        name: integrationConnections.name,
        status: integrationConnections.status,
        lastSyncAt: integrationConnections.lastSyncAt,
        lastError: integrationConnections.lastError,
      })
      .from(integrationConnections)
      .where(
        and(
          isNull(integrationConnections.deletedAt),
          inArray(integrationConnections.kind, [...SYSTEM_SYNC_KINDS]),
        ),
      )
      .orderBy(integrationConnections.name);
    const runs = await tx
      .select({
        id: integrationSyncRuns.id,
        connectionId: integrationSyncRuns.connectionId,
        kind: integrationSyncRuns.kind,
        status: integrationSyncRuns.status,
        received: integrationSyncRuns.received,
        staged: integrationSyncRuns.staged,
        errorCount: integrationSyncRuns.errorCount,
        publicError: integrationSyncRuns.publicError,
        startedAt: integrationSyncRuns.startedAt,
        completedAt: integrationSyncRuns.completedAt,
        createdAt: integrationSyncRuns.createdAt,
      })
      .from(integrationSyncRuns)
      .orderBy(desc(integrationSyncRuns.createdAt))
      .limit(30);
    const staging = await tx
      .select({
        id: integrationStagingRecords.id,
        connectionId: integrationStagingRecords.connectionId,
        sourceKey: integrationStagingRecords.sourceKey,
        entityType: integrationStagingRecords.entityType,
        payloadJson: integrationStagingRecords.payloadJson,
        status: integrationStagingRecords.status,
        updatedAt: integrationStagingRecords.updatedAt,
      })
      .from(integrationStagingRecords)
      .orderBy(desc(integrationStagingRecords.updatedAt))
      .limit(50);
    return { connections, runs, staging };
  });
}

export async function requestSystemSync(viewer: Viewer, connectionId: string) {
  return withTenant(viewer.tenantId, async (tx) => {
    const [connection] = await tx
      .select({
        id: integrationConnections.id,
        kind: integrationConnections.kind,
        name: integrationConnections.name,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          eq(integrationConnections.status, "active"),
          isNull(integrationConnections.deletedAt),
          inArray(integrationConnections.kind, [...SYSTEM_SYNC_KINDS]),
        ),
      )
      .limit(1);
    if (!connection) throw new Error("active system integration was not found");
    const kind = connection.kind as SystemSyncKind;
    const [run] = await tx
      .insert(integrationSyncRuns)
      .values({
        tenantId: viewer.tenantId,
        connectionId: connection.id,
        kind,
        status: "queued",
        requestedBy: viewer.userId,
      })
      .returning({ id: integrationSyncRuns.id });
    if (!run) throw new Error("failed to create integration sync run");
    const payload = { runId: run.id, connectionId: connection.id, kind };
    const job = await enqueueTenantJobInTx(tx, {
      tenantId: viewer.tenantId,
      requestedBy: viewer.userId,
      kind: "integration.sync",
      payload,
      dedupeKey: jobDedupeKey("integration.sync", { connectionId: connection.id }),
      maxAttempts: 4,
    });
    await tx
      .update(integrationSyncRuns)
      .set({ jobId: job.id, updatedAt: new Date() })
      .where(eq(integrationSyncRuns.id, run.id));
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "integration.sync.request",
      entityType: "integration_connection",
      entityId: connection.id,
      changes: JSON.stringify({
        runId: run.id,
        jobId: job.id,
        kind,
        name: connection.name,
        deduplicated: job.deduplicated,
      }),
    });
    return { runId: run.id, jobId: job.id, deduplicated: job.deduplicated };
  });
}

export async function setStagingRecordDisposition(
  viewer: Viewer,
  id: string,
  disposition: "pending" | "ignored",
) {
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(integrationStagingRecords)
      .set({ status: disposition, updatedAt: new Date() })
      .where(eq(integrationStagingRecords.id, id))
      .returning({
        id: integrationStagingRecords.id,
        connectionId: integrationStagingRecords.connectionId,
      });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "integration.staging.disposition",
      entityType: "integration_staging_record",
      entityId: row.id,
      changes: JSON.stringify({ disposition, connectionId: row.connectionId }),
    });
    return true;
  });
}
