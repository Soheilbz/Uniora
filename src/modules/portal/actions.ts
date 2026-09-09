"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { portalLinks, professors, students, user } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { isTenantFeatureEnabled } from "@/lib/features.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

const SETTINGS = "/settings/portals";

export async function savePortalLink(form: FormData): Promise<void> {
  const viewer = await requireCapability("users.manage");
  if (!(await isTenantFeatureEnabled(viewer.tenantId, "portals"))) return;
  const userId = String(form.get("userId") ?? "").trim();
  const subjectType = String(form.get("subjectType") ?? "");
  const subjectId = String(form.get("subjectId") ?? "");
  if (!userId || !isUuid(subjectId) || (subjectType !== "student" && subjectType !== "professor"))
    return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, userId), eq(user.tenantId, viewer.tenantId), isNull(user.suspendedAt)))
      .limit(1);
    if (!account) return;
    const subject =
      subjectType === "student"
        ? await tx
            .select({ id: students.id })
            .from(students)
            .where(and(eq(students.id, subjectId), isNull(students.deletedAt)))
            .limit(1)
        : await tx
            .select({ id: professors.id })
            .from(professors)
            .where(and(eq(professors.id, subjectId), isNull(professors.deletedAt)))
            .limit(1);
    if (!subject[0]) return;

    const [existing] = await tx
      .select({ id: portalLinks.id, version: portalLinks.version })
      .from(portalLinks)
      .where(
        and(
          eq(portalLinks.userId, userId),
          eq(portalLinks.subjectType, subjectType),
          isNull(portalLinks.deletedAt),
        ),
      )
      .limit(1);
    const values = {
      status: "active",
      studentId: subjectType === "student" ? subjectId : null,
      professorId: subjectType === "professor" ? subjectId : null,
      updatedAt: sql`now()`,
    } as const;
    const linkId = existing
      ? (
          await tx
            .update(portalLinks)
            .set({ ...values, version: sql`${portalLinks.version} + 1` })
            .where(and(eq(portalLinks.id, existing.id), eq(portalLinks.version, existing.version)))
            .returning({ id: portalLinks.id })
        )[0]?.id
      : (
          await tx
            .insert(portalLinks)
            .values({ tenantId: viewer.tenantId, userId, subjectType, ...values })
            .returning({ id: portalLinks.id })
        )[0]?.id;
    if (!linkId) return;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: existing ? "portal_link.update" : "portal_link.create",
      entityType: "portal_link",
      entityId: linkId,
      changes: JSON.stringify({ userId, subjectType, subjectId, status: "active" }),
    });
  });
  revalidatePath(SETTINGS);
}

export async function setPortalLinkStatus(form: FormData): Promise<void> {
  const viewer = await requireCapability("users.manage");
  if (!(await isTenantFeatureEnabled(viewer.tenantId, "portals"))) return;
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "");
  const version = Number(form.get("version"));
  if (
    !isUuid(id) ||
    !Number.isInteger(version) ||
    version < 1 ||
    !["active", "suspended", "revoked"].includes(status)
  )
    return;
  await withTenant(viewer.tenantId, async (tx) => {
    const [before] = await tx
      .select({ status: portalLinks.status, version: portalLinks.version })
      .from(portalLinks)
      .where(and(eq(portalLinks.id, id), isNull(portalLinks.deletedAt)))
      .limit(1);
    if (!before || before.status === status) return;
    const changed = await tx
      .update(portalLinks)
      .set({ status, updatedAt: sql`now()`, version: sql`${portalLinks.version} + 1` })
      .where(and(eq(portalLinks.id, id), eq(portalLinks.version, version)))
      .returning({ id: portalLinks.id });
    if (!changed[0]) return;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "portal_link.status",
      entityType: "portal_link",
      entityId: id,
      changes: JSON.stringify({ status: { from: before.status, to: status } }),
    });
  });
  revalidatePath(SETTINGS);
}
