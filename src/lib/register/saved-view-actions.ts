"use server";

import { and, count, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { roles, savedViews, userRoles } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { can } from "@/lib/capabilities.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireViewer } from "@/lib/viewer.ts";
import type { ActionResult } from "./action-result.ts";
import {
  cleanName,
  cleanQuery,
  cleanRegister,
  cleanScope,
  MAX_SAVED_VIEWS,
} from "./saved-views.ts";

export async function saveView(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const name = cleanName(form.get("name"));
  const register = cleanRegister(form.get("register"));
  const query = cleanQuery(form.get("query"));
  const scope = cleanScope(form.get("scope"));

  if (name === "") return { ok: false, errors: { name: "errors.required" } };
  if (register === "") return { ok: false, message: "errors.record.missing" };
  if (scope !== "private" && !can(viewer, "saved-views.publish")) {
    return { ok: false, message: "forbidden.title" };
  }

  const refused = await withTenant(viewer.tenantId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${viewer.tenantId}:${viewer.userId}:${register}`}, 0))`,
    );

    let audienceRoleId: string | null = null;
    if (scope === "team") {
      const [membership] = await tx
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, viewer.tenantId)))
        .where(and(eq(userRoles.tenantId, viewer.tenantId), eq(userRoles.userId, viewer.userId)))
        .orderBy(desc(roles.tier), roles.name)
        .limit(1);
      if (!membership) return "team" as const;
      audienceRoleId = membership.roleId;
    }

    const [sameName] = await tx
      .select({ id: savedViews.id })
      .from(savedViews)
      .where(
        and(
          eq(savedViews.userId, viewer.userId),
          eq(savedViews.register, register),
          eq(savedViews.name, name),
        ),
      )
      .limit(1);

    if (!sameName) {
      const [total] = await tx
        .select({ value: count() })
        .from(savedViews)
        .where(and(eq(savedViews.userId, viewer.userId), eq(savedViews.register, register)));
      if ((total?.value ?? 0) >= MAX_SAVED_VIEWS) return "limit" as const;
    }

    const publication = {
      query,
      scope,
      audienceRoleId,
      publishedBy: scope === "private" ? null : viewer.userId,
      updatedAt: new Date(),
    };
    if (sameName) {
      await tx
        .update(savedViews)
        .set(publication)
        .where(and(eq(savedViews.id, sameName.id), eq(savedViews.userId, viewer.userId)));
    } else {
      await tx.insert(savedViews).values({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        register,
        name,
        ...publication,
      });
    }
    return null;
  });

  if (refused === "limit") return { ok: false, errors: { name: "views.tooMany" } };
  if (refused === "team") return { ok: false, message: "views.teamUnavailable" };
  revalidatePath(register);
  return { ok: true };
}

export async function deleteView(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const id = String(form.get("id") ?? "").trim();
  const register = cleanRegister(form.get("register"));
  if (id === "" || !isUuid(id)) return { ok: false, message: "errors.record.missing" };

  await withTenant(viewer.tenantId, (tx) =>
    tx.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, viewer.userId))),
  );

  if (register !== "") revalidatePath(register);
  return { ok: true };
}
