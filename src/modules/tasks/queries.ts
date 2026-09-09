import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { tasks, user } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Viewer } from "@/lib/capabilities.ts";

/** Workflow inbox. Managers see the tenant queue; ordinary viewers see work assigned to them. */
export async function readTasks(viewer: Viewer, limit = 100) {
  const manager = viewer.capabilities.includes("tasks.manage");
  return readOnly(viewer.tenantId, (tx) =>
    tx
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        entityType: tasks.entityType,
        entityId: tasks.entityId,
        assignedTo: tasks.assignedTo,
        assigneeName: user.name,
        dueAt: tasks.dueAt,
        priority: tasks.priority,
        status: tasks.status,
        createdAt: tasks.createdAt,
        version: tasks.version,
      })
      .from(tasks)
      .leftJoin(user, and(eq(user.tenantId, tasks.tenantId), eq(user.id, tasks.assignedTo)))
      .where(
        and(
          isNull(tasks.deletedAt),
          manager
            ? undefined
            : or(eq(tasks.assignedTo, viewer.userId), eq(tasks.createdBy, viewer.userId)),
        ),
      )
      .orderBy(asc(tasks.completedAt), asc(tasks.dueAt), desc(tasks.createdAt), desc(tasks.id))
      .limit(Math.min(Math.max(limit, 1), 250)),
  );
}
