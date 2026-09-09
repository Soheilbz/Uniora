"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notifications } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { requireViewer } from "@/lib/viewer.ts";

function notificationId(formData: FormData): string {
  const value = String(formData.get("notificationId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("invalid notification id");
  return value;
}

export async function markNotificationRead(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const id = notificationId(formData);
  await withTenant(viewer.tenantId, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, viewer.tenantId),
          eq(notifications.id, id),
          eq(notifications.userId, viewer.userId),
          isNull(notifications.dismissedAt),
        ),
      ),
  );
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function dismissNotification(formData: FormData): Promise<void> {
  const viewer = await requireViewer();
  const id = notificationId(formData);
  const now = new Date();
  await withTenant(viewer.tenantId, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: now, dismissedAt: now, updatedAt: now })
      .where(
        and(
          eq(notifications.tenantId, viewer.tenantId),
          eq(notifications.id, id),
          eq(notifications.userId, viewer.userId),
        ),
      ),
  );
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead(): Promise<void> {
  const viewer = await requireViewer();
  await withTenant(viewer.tenantId, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, viewer.tenantId),
          eq(notifications.userId, viewer.userId),
          isNull(notifications.readAt),
          isNull(notifications.dismissedAt),
        ),
      ),
  );
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
