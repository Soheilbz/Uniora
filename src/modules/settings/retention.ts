import { and, desc, eq, sql } from "drizzle-orm";
import { jobs, retentionPolicies } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/viewer.ts";

export const RETENTION_RESOURCE_CATALOG = [
  { key: "notifications", defaultDays: 180, minDays: 30, maxDays: 3650 },
  { key: "recent_records", defaultDays: 90, minDays: 7, maxDays: 365 },
  { key: "quality_snapshots", defaultDays: 730, minDays: 90, maxDays: 3650 },
  { key: "webhook_deliveries", defaultDays: 365, minDays: 30, maxDays: 3650 },
  { key: "job_attempts", defaultDays: 180, minDays: 30, maxDays: 3650 },
  { key: "api_rate_windows", defaultDays: 7, minDays: 1, maxDays: 30 },
] as const;

export type RetentionResource = (typeof RETENTION_RESOURCE_CATALOG)[number]["key"];

function resourceDefinition(value: string) {
  return RETENTION_RESOURCE_CATALOG.find((item) => item.key === value) ?? null;
}

export async function readRetentionPolicies(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: retentionPolicies.id,
        resource: retentionPolicies.resource,
        retainDays: retentionPolicies.retainDays,
        mode: retentionPolicies.mode,
        enabled: retentionPolicies.enabled,
        legalHold: retentionPolicies.legalHold,
        version: retentionPolicies.version,
        updatedAt: retentionPolicies.updatedAt,
      })
      .from(retentionPolicies)
      .orderBy(retentionPolicies.resource);
    return new Map(rows.map((row) => [row.resource, row]));
  });
}

export async function readRetentionRuns(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: jobs.id,
        status: jobs.status,
        payload: jobs.payload,
        result: jobs.result,
        publicError: jobs.publicError,
        requestedBy: jobs.requestedBy,
        createdAt: jobs.createdAt,
        startedAt: jobs.startedAt,
        completedAt: jobs.completedAt,
      })
      .from(jobs)
      .where(eq(jobs.kind, "retention.purge"))
      .orderBy(desc(jobs.createdAt))
      .limit(12),
  );
}

export async function saveRetentionPolicy(
  viewer: Viewer,
  input: {
    resource: string;
    retainDays: number;
    enabled: boolean;
    legalHold: boolean;
    expectedVersion?: number;
  },
): Promise<boolean> {
  const definition = resourceDefinition(input.resource);
  if (!definition) throw new Error("unsupported retention resource");
  if (
    !Number.isInteger(input.retainDays) ||
    input.retainDays < definition.minDays ||
    input.retainDays > definition.maxDays
  ) {
    throw new Error("retention period is outside the supported range");
  }
  return withTenant(viewer.tenantId, async (tx) => {
    const current = await tx
      .select({ id: retentionPolicies.id, version: retentionPolicies.version })
      .from(retentionPolicies)
      .where(eq(retentionPolicies.resource, definition.key))
      .limit(1);
    const existing = current[0];
    if (!existing) {
      const [created] = await tx
        .insert(retentionPolicies)
        .values({
          tenantId: viewer.tenantId,
          resource: definition.key,
          retainDays: input.retainDays,
          mode: "purge",
          enabled: input.enabled,
          legalHold: input.legalHold,
        })
        .returning({ id: retentionPolicies.id });
      if (!created) return false;
      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "retention.policy.create",
        entityType: "retention_policy",
        entityId: created.id,
        changes: JSON.stringify({
          resource: definition.key,
          retainDays: input.retainDays,
          enabled: input.enabled,
          legalHold: input.legalHold,
        }),
      });
      return true;
    }
    if (!Number.isInteger(input.expectedVersion)) return false;
    const [updated] = await tx
      .update(retentionPolicies)
      .set({
        retainDays: input.retainDays,
        mode: "purge",
        enabled: input.enabled,
        legalHold: input.legalHold,
        version: sql`${retentionPolicies.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(retentionPolicies.id, existing.id),
          eq(retentionPolicies.version, input.expectedVersion as number),
        ),
      )
      .returning({ id: retentionPolicies.id });
    if (!updated) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "retention.policy.update",
      entityType: "retention_policy",
      entityId: existing.id,
      changes: JSON.stringify({
        resource: definition.key,
        retainDays: input.retainDays,
        enabled: input.enabled,
        legalHold: input.legalHold,
      }),
    });
    return true;
  });
}

export async function enqueueRetentionRun(viewer: Viewer, dryRun: boolean) {
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        tenantId: viewer.tenantId,
        kind: "retention.purge",
        executionClass: "tenant",
        payload: JSON.stringify({ dryRun }),
        requestedBy: viewer.userId,
        dedupeKey: dryRun ? "retention:dry-run" : "retention:purge",
        maxAttempts: 5,
      })
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    if (!row) return null;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: dryRun ? "retention.dry_run.request" : "retention.purge.request",
      entityType: "job",
      entityId: row.id,
      changes: JSON.stringify({ dryRun }),
    });
    return row;
  });
}
