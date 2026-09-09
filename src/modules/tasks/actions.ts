"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tasks, taskTransitions } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { endOfDateInTimeZone } from "@/lib/date-time.ts";
import { requireCapability } from "@/lib/viewer.ts";

const PRIORITIES = new Set(["low", "normal", "high", "critical"]);
const STATUSES = new Set(["open", "in_progress", "blocked", "completed", "cancelled"]);

function field(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? "")
    .trim()
    .slice(0, max);
}

export async function createTask(form: FormData): Promise<void> {
  const viewer = await requireCapability("tasks.manage");
  const title = field(form, "title", 300);
  if (!title) return;
  const description = field(form, "description", 4000) || null;
  const priorityRaw = field(form, "priority", 20);
  const priority = PRIORITIES.has(priorityRaw) ? priorityRaw : "normal";
  const dueOn = field(form, "dueOn", 10);
  let dueAt: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
    try {
      dueAt = endOfDateInTimeZone(dueOn, viewer.tenantTimezone);
    } catch {
      dueAt = null;
    }
  }

  await withTenant(viewer.tenantId, async (tx) => {
    const [created] = await tx
      .insert(tasks)
      .values({
        tenantId: viewer.tenantId,
        title,
        description,
        priority,
        dueAt,
        assignedTo: viewer.userId,
        createdBy: viewer.userId,
      })
      .returning({ id: tasks.id });
    if (!created) return;
    await tx.insert(taskTransitions).values({
      tenantId: viewer.tenantId,
      taskId: created.id,
      actorId: viewer.userId,
      fromStatus: null,
      toStatus: "open",
      reason: "created",
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "task.create",
      entityType: "task",
      entityId: created.id,
      changes: JSON.stringify({ title, priority, dueOn: dueOn || null }),
    });
  });
  revalidatePath("/tasks");
}

export async function transitionTask(form: FormData): Promise<void> {
  const viewer = await requireCapability("tasks.view");
  const id = field(form, "id", 36);
  const version = Number(field(form, "version", 12));
  const next = field(form, "status", 30);
  if (!id || !Number.isSafeInteger(version) || !STATUSES.has(next)) return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [record] = await tx
      .select({ status: tasks.status, assignedTo: tasks.assignedTo, createdBy: tasks.createdBy })
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    if (!record) return;
    const manager = viewer.capabilities.includes("tasks.manage");
    if (!manager && record.assignedTo !== viewer.userId && record.createdBy !== viewer.userId)
      return;
    if (record.status === next) return;
    const completed = next === "completed";
    const changed = await tx
      .update(tasks)
      .set({
        status: next,
        completedAt: completed ? new Date() : null,
        completedBy: completed ? viewer.userId : null,
        updatedAt: new Date(),
        version: sql`${tasks.version} + 1`,
      })
      .where(and(eq(tasks.id, id), eq(tasks.version, version)))
      .returning({ id: tasks.id });
    if (changed.length === 0) return;
    await tx.insert(taskTransitions).values({
      tenantId: viewer.tenantId,
      taskId: id,
      actorId: viewer.userId,
      fromStatus: record.status,
      toStatus: next,
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "task.transition",
      entityType: "task",
      entityId: id,
      changes: JSON.stringify({ status: { from: record.status, to: next } }),
    });
  });
  revalidatePath("/tasks");
}
