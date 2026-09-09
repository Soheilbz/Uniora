import { and, desc, eq } from "drizzle-orm";
import { recentRecords, userRecordPins } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import { can } from "@/lib/capabilities.ts";
import { isSafeInternalPath } from "@/lib/internal-redirect.ts";

export const QUICK_ENTITY_TYPES = [
  "student",
  "professor",
  "workshop",
  "council_decision",
  "research_project",
  "correspondence",
] as const;
export type QuickEntityType = (typeof QUICK_ENTITY_TYPES)[number];
export function isQuickEntityType(value: string): value is QuickEntityType {
  return (QUICK_ENTITY_TYPES as readonly string[]).includes(value);
}
export function safeRecordHref(href: string): boolean {
  return isSafeInternalPath(href, 500);
}
export function canUseQuickEntity(viewer: Viewer, type: QuickEntityType): boolean {
  if (type === "student") return can(viewer, "students.view");
  if (type === "professor") return can(viewer, "professors.view");
  if (type === "workshop") return can(viewer, "workshops.view");
  if (type === "council_decision") return can(viewer, "council.view");
  if (type === "research_project") return can(viewer, "research-projects.view");
  return can(viewer, "correspondence.view");
}

export async function readQuickRecords(viewer: Viewer) {
  return readOnly(viewer.tenantId, async (tx) => {
    const pins = await tx
      .select({
        entityType: userRecordPins.entityType,
        entityId: userRecordPins.entityId,
        label: userRecordPins.labelSnapshot,
        href: userRecordPins.href,
      })
      .from(userRecordPins)
      .where(eq(userRecordPins.userId, viewer.userId))
      .orderBy(desc(userRecordPins.updatedAt))
      .limit(12);
    const recent = await tx
      .select({
        entityType: recentRecords.entityType,
        entityId: recentRecords.entityId,
        label: recentRecords.labelSnapshot,
        href: recentRecords.href,
      })
      .from(recentRecords)
      .where(eq(recentRecords.userId, viewer.userId))
      .orderBy(desc(recentRecords.openedAt))
      .limit(12);
    return { pins, recent };
  });
}
export async function isPinned(viewer: Viewer, entityType: QuickEntityType, entityId: string) {
  return readOnly(viewer.tenantId, async (tx) =>
    Boolean(
      (
        await tx
          .select({ id: userRecordPins.id })
          .from(userRecordPins)
          .where(
            and(
              eq(userRecordPins.userId, viewer.userId),
              eq(userRecordPins.entityType, entityType),
              eq(userRecordPins.entityId, entityId),
            ),
          )
          .limit(1)
      )[0],
    ),
  );
}
export async function recordRecent(
  viewer: Viewer,
  entityType: QuickEntityType,
  entityId: string,
  label: string,
  href: string,
) {
  if (
    !canUseQuickEntity(viewer, entityType) ||
    !safeRecordHref(href) ||
    label.length < 1 ||
    label.length > 240 ||
    entityId.length > 120
  )
    return;
  await withTenant(viewer.tenantId, (tx) =>
    tx
      .insert(recentRecords)
      .values({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        entityType,
        entityId,
        labelSnapshot: label,
        href,
      })
      .onConflictDoUpdate({
        target: [
          recentRecords.tenantId,
          recentRecords.userId,
          recentRecords.entityType,
          recentRecords.entityId,
        ],
        set: { labelSnapshot: label, href, openedAt: new Date(), updatedAt: new Date() },
      }),
  );
}
export async function setPinned(
  viewer: Viewer,
  entityType: QuickEntityType,
  entityId: string,
  label: string,
  href: string,
  pinned: boolean,
) {
  if (
    !canUseQuickEntity(viewer, entityType) ||
    !safeRecordHref(href) ||
    label.length < 1 ||
    label.length > 240 ||
    entityId.length > 120
  )
    return;
  await withTenant(viewer.tenantId, async (tx) => {
    if (!pinned) {
      await tx
        .delete(userRecordPins)
        .where(
          and(
            eq(userRecordPins.userId, viewer.userId),
            eq(userRecordPins.entityType, entityType),
            eq(userRecordPins.entityId, entityId),
          ),
        );
      return;
    }
    await tx
      .insert(userRecordPins)
      .values({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        entityType,
        entityId,
        labelSnapshot: label,
        href,
      })
      .onConflictDoUpdate({
        target: [
          userRecordPins.tenantId,
          userRecordPins.userId,
          userRecordPins.entityType,
          userRecordPins.entityId,
        ],
        set: { labelSnapshot: label, href, updatedAt: new Date() },
      });
  });
}
