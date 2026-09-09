"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { roleCapabilities, roles, tenantOwners, user, userRoles } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { isAuthId } from "@/lib/auth-id.ts";
import { ADMINISTRATOR_TIER } from "@/lib/capabilities.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { requireElevatedSession } from "@/lib/step-up.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { currentTenantAuthority } from "./current-authority.ts";

export async function transferTenantOwnership(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage", "roles.manage");
  if (!viewer.isTenantOwner) return { ok: false, message: "ownerOnly" };
  await requireElevatedSession(viewer, "/settings/ownership");

  const targetId = String(form.get("userId") ?? "");
  if (!isAuthId(targetId) || targetId === viewer.userId)
    return { ok: false, message: "invalidOwner" };

  const changed = await withTenant(viewer.tenantId, async (tx) => {
    const current = await currentTenantAuthority(
      tx,
      viewer.tenantId,
      viewer.userId,
      ["users.manage", "roles.manage"],
      { requireOwner: true },
    );
    if (!current) return false;
    const [target] = await tx
      .select({
        id: user.id,
        suspendedAt: user.suspendedAt,
        employmentStart: user.employmentStart,
        employmentEnd: user.employmentEnd,
        accountExpiresAt: user.accountExpiresAt,
        mustChangePassword: user.mustChangePassword,
      })
      .from(user)
      .innerJoin(
        userRoles,
        and(eq(userRoles.userId, user.id), eq(userRoles.tenantId, viewer.tenantId)),
      )
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, viewer.tenantId)))
      .where(
        and(
          eq(user.id, targetId),
          eq(user.tenantId, viewer.tenantId),
          eq(roles.tier, ADMINISTRATOR_TIER),
        ),
      )
      .limit(1);
    const currentDate = await tx.execute(sql`select current_date::text as today`);
    const today = String((currentDate.rows[0] as { today?: unknown } | undefined)?.today ?? "");
    if (
      !target ||
      target.suspendedAt !== null ||
      (target.accountExpiresAt !== null && target.accountExpiresAt <= new Date()) ||
      (target.employmentStart !== null && target.employmentStart > today) ||
      (target.employmentEnd !== null && target.employmentEnd < today) ||
      target.mustChangePassword
    )
      return false;

    const targetCapabilities = await tx
      .select({ capability: roleCapabilities.capability })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, viewer.tenantId)))
      .innerJoin(roleCapabilities, eq(roleCapabilities.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, targetId),
          eq(userRoles.tenantId, viewer.tenantId),
          inArray(roleCapabilities.capability, ["users.manage", "roles.manage"]),
        ),
      );
    const targetCapabilitySet = new Set(targetCapabilities.map((row) => row.capability));
    if (!targetCapabilitySet.has("users.manage") || !targetCapabilitySet.has("roles.manage"))
      return false;

    const [before] = await tx
      .select({ userId: tenantOwners.userId })
      .from(tenantOwners)
      .where(eq(tenantOwners.tenantId, viewer.tenantId))
      .limit(1);
    if (before?.userId !== viewer.userId) return false;

    await tx
      .insert(tenantOwners)
      .values({ tenantId: viewer.tenantId, userId: targetId })
      .onConflictDoUpdate({
        target: tenantOwners.tenantId,
        set: { userId: targetId, updatedAt: new Date() },
      });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      subjectId: targetId,
      action: "tenant.owner.transferred",
      entityType: "tenant_owner",
      entityId: viewer.tenantId,
      changes: JSON.stringify({ owner: { from: viewer.userId, to: targetId } }),
    });
    return true;
  });

  if (!changed) return { ok: false, message: "invalidOwner" };
  revalidatePath("/settings", "layout");
  return { ok: true, message: "ownerTransferred" };
}
