import { and, asc, eq, inArray, or } from "drizzle-orm";
import { savedViews, userRoles } from "@/db/schema.ts";
import { readOnly, type TenantTx } from "@/db/tenant.ts";

export type SavedViewScope = "private" | "team" | "tenant";

export interface SavedView {
  id: string;
  name: string;
  query: string;
  scope: SavedViewScope;
  owned: boolean;
}

export const MAX_SAVED_VIEWS = 12;
export const MAX_VISIBLE_SAVED_VIEWS = 48;

export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function cleanQuery(raw: unknown): string {
  const params = new URLSearchParams(
    String(raw ?? "")
      .replace(/^\?/, "")
      .slice(0, 2000),
  );
  params.delete("page");
  params.delete("cursor");
  return params.toString();
}

export function cleanRegister(raw: unknown): string {
  const value = String(raw ?? "").trim();
  return /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(value) ? value.slice(0, 120) : "";
}

export function cleanScope(raw: unknown): SavedViewScope {
  return raw === "team" || raw === "tenant" ? raw : "private";
}

/**
 * Reads personal definitions plus tenant-wide publications and role-scoped
 * team publications. Publication is only a bookmark; the destination register
 * still enforces its own capability and RLS boundaries.
 */
export async function readSavedViewsInTx(
  tx: TenantTx,
  userId: string,
  register: string,
): Promise<SavedView[]> {
  const memberships = await tx
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  const roleIds = memberships.map((row) => row.roleId);

  const visible = [
    eq(savedViews.userId, userId),
    eq(savedViews.scope, "tenant"),
    ...(roleIds.length > 0
      ? [and(eq(savedViews.scope, "team"), inArray(savedViews.audienceRoleId, roleIds))]
      : []),
  ];

  const rows = await tx
    .select({
      id: savedViews.id,
      name: savedViews.name,
      query: savedViews.query,
      scope: savedViews.scope,
      userId: savedViews.userId,
    })
    .from(savedViews)
    .where(and(eq(savedViews.register, register), or(...visible)))
    .orderBy(asc(savedViews.scope), asc(savedViews.name), asc(savedViews.id))
    .limit(MAX_VISIBLE_SAVED_VIEWS);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    query: row.query,
    scope: row.scope as SavedViewScope,
    owned: row.userId === userId,
  }));
}

export async function readSavedViews(tenantId: string, userId: string, register: string) {
  return readOnly(tenantId, (tx) => readSavedViewsInTx(tx, userId, register));
}
