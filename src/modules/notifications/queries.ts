import { and, desc, eq, isNull } from "drizzle-orm";
import { notifications } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Viewer } from "@/lib/capabilities.ts";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: "info" | "success" | "warning" | "error";
  readAt: Date | null;
  createdAt: Date;
}

export async function readNotifications(viewer: Viewer, limit = 20): Promise<NotificationItem[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return readOnly(viewer.tenantId, (tx) =>
    tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        severity: notifications.severity,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, viewer.tenantId),
          eq(notifications.userId, viewer.userId),
          isNull(notifications.dismissedAt),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(safeLimit),
  ) as Promise<NotificationItem[]>;
}

export async function unreadNotificationCount(viewer: Viewer): Promise<number> {
  return readOnly(viewer.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, viewer.tenantId),
          eq(notifications.userId, viewer.userId),
          isNull(notifications.readAt),
          isNull(notifications.dismissedAt),
        ),
      )
      .limit(100);
    return rows.length;
  });
}
