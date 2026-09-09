import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { jobs, scheduledJobs } from "@/db/schema.ts";
import { readOnly, type TenantTx, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { type Capability, can } from "@/lib/capabilities.ts";
import {
  buildScheduleSpec,
  calculateNextRunAt,
  parseScheduleSpec,
  serializeScheduleSpec,
  validateTimeZone,
} from "@/lib/scheduling.ts";
import type { Viewer } from "@/lib/viewer.ts";

export const SCHEDULABLE_JOB_KINDS = [
  "export.students",
  "export.professors",
  "export.council-decisions",
  "export.workshops",
  "export.capacity",
  "export.audit",
  "quality.scan",
  "analytics.refresh",
  "notification.reminder",
] as const;
export type SchedulableJobKind = (typeof SCHEDULABLE_JOB_KINDS)[number];

const REQUIRED: Record<SchedulableJobKind, readonly Capability[]> = {
  "export.students": ["reports.schedule", "data.export", "students.view"],
  "export.professors": ["reports.schedule", "data.export", "professors.view"],
  "export.council-decisions": ["reports.schedule", "data.export", "council.view"],
  "export.workshops": ["reports.schedule", "data.export", "workshops.view"],
  "export.capacity": ["reports.schedule", "data.export", "capacity.view"],
  "export.audit": ["reports.schedule", "data.export", "audit.view"],
  "quality.scan": ["reports.schedule", "data.quality.manage"],
  "analytics.refresh": ["reports.schedule"],
  "notification.reminder": ["reports.schedule"],
};

export interface ScheduleInput {
  name: string;
  kind: string;
  recurrenceType: string;
  intervalMinutes?: number;
  at?: string;
  weekdays?: readonly number[];
  timezone?: string;
  reminderTitle?: string;
  reminderBody?: string;
  reminderHref?: string;
}

function assertKind(viewer: Viewer, value: string): SchedulableJobKind {
  if (!(SCHEDULABLE_JOB_KINDS as readonly string[]).includes(value))
    throw new Error("unsupported scheduled job kind");
  const kind = value as SchedulableJobKind;
  if (!can(viewer, ...REQUIRED[kind])) throw new Error("scheduled job permission denied");
  return kind;
}

function payloadFor(kind: SchedulableJobKind, input: ScheduleInput): string {
  if (kind !== "notification.reminder") return "{}";
  const title = input.reminderTitle?.trim().slice(0, 180) ?? "";
  if (!title) throw new Error("reminder title is required");
  const body = input.reminderBody?.trim().slice(0, 1000) || null;
  const href = input.reminderHref?.trim().slice(0, 500) || null;
  if (href && !href.startsWith("/")) throw new Error("reminder link must be an application path");
  return JSON.stringify({ title, body, href, severity: "info" });
}

async function enqueueDispatcher(tx: TenantTx, tenantId: string, userId: string, at: Date) {
  await tx
    .insert(jobs)
    .values({
      tenantId,
      kind: "schedule.dispatch",
      executionClass: "tenant",
      payload: "{}",
      requestedBy: userId,
      dedupeKey: `schedule-dispatch:${at.toISOString()}`,
      scheduledAt: at,
      maxAttempts: 8,
    })
    .onConflictDoNothing();
}

export async function listScheduledJobs(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: scheduledJobs.id,
        name: scheduledJobs.name,
        kind: scheduledJobs.kind,
        schedule: scheduledJobs.schedule,
        timezone: scheduledJobs.timezone,
        payload: scheduledJobs.payload,
        enabled: scheduledJobs.enabled,
        nextRunAt: scheduledJobs.nextRunAt,
        lastRunAt: scheduledJobs.lastRunAt,
        version: scheduledJobs.version,
        createdAt: scheduledJobs.createdAt,
      })
      .from(scheduledJobs)
      .where(isNull(scheduledJobs.deletedAt))
      .orderBy(asc(scheduledJobs.name)),
  );
}

export async function createScheduledJob(viewer: Viewer, input: ScheduleInput) {
  const kind = assertKind(viewer, input.kind);
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("schedule name is required");
  const timezone = validateTimeZone(input.timezone || viewer.tenantTimezone || "UTC");
  const spec = buildScheduleSpec({
    type: input.recurrenceType,
    ...(input.intervalMinutes !== undefined ? { intervalMinutes: input.intervalMinutes } : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
    ...(input.weekdays !== undefined ? { weekdays: input.weekdays } : {}),
  });
  const schedule = serializeScheduleSpec(spec);
  const nextRunAt = calculateNextRunAt(spec, timezone, new Date());
  if (!nextRunAt) throw new Error("schedule has no next run");
  const payload = payloadFor(kind, input);

  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .insert(scheduledJobs)
      .values({
        tenantId: viewer.tenantId,
        name,
        kind,
        schedule,
        timezone,
        payload,
        enabled: true,
        nextRunAt,
        createdBy: viewer.userId,
      })
      .returning({ id: scheduledJobs.id });
    if (!row) throw new Error("failed to create scheduled job");
    await enqueueDispatcher(tx, viewer.tenantId, viewer.userId, nextRunAt);
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "scheduled_job.create",
      entityType: "scheduled_job",
      entityId: row.id,
      changes: JSON.stringify({
        name,
        kind,
        schedule,
        timezone,
        nextRunAt: nextRunAt.toISOString(),
      }),
    });
    return row;
  });
}

export async function setScheduledJobEnabled(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
  enabled: boolean,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const current = await tx
      .select({
        schedule: scheduledJobs.schedule,
        timezone: scheduledJobs.timezone,
        kind: scheduledJobs.kind,
      })
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.id, id),
          eq(scheduledJobs.version, expectedVersion),
          isNull(scheduledJobs.deletedAt),
        ),
      )
      .limit(1);
    const item = current[0];
    if (!item) return false;
    assertKind(viewer, item.kind);
    const nextRunAt = enabled
      ? calculateNextRunAt(parseScheduleSpec(item.schedule), item.timezone, new Date())
      : null;
    const [row] = await tx
      .update(scheduledJobs)
      .set({
        enabled,
        nextRunAt,
        version: sql`${scheduledJobs.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledJobs.id, id),
          eq(scheduledJobs.version, expectedVersion),
          isNull(scheduledJobs.deletedAt),
        ),
      )
      .returning({ id: scheduledJobs.id });
    if (!row) return false;
    if (enabled && nextRunAt)
      await enqueueDispatcher(tx, viewer.tenantId, viewer.userId, nextRunAt);
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: enabled ? "scheduled_job.enable" : "scheduled_job.disable",
      entityType: "scheduled_job",
      entityId: id,
      changes: JSON.stringify({ enabled }),
    });
    return true;
  });
}

export async function retireScheduledJob(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(scheduledJobs)
      .set({
        enabled: false,
        nextRunAt: null,
        deletedAt: now,
        version: sql`${scheduledJobs.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(scheduledJobs.id, id),
          eq(scheduledJobs.version, expectedVersion),
          isNull(scheduledJobs.deletedAt),
        ),
      )
      .returning({ id: scheduledJobs.id, kind: scheduledJobs.kind });
    if (!row) return false;
    assertKind(viewer, row.kind);
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "scheduled_job.retire",
      entityType: "scheduled_job",
      entityId: id,
      changes: JSON.stringify({ retiredAt: now.toISOString() }),
    });
    return true;
  });
}
