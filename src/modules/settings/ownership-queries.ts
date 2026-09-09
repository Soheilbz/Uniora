import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { roleCapabilities, roles, tenantOwners, user, userRoles } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { ADMINISTRATOR_TIER } from "@/lib/capabilities.ts";
import { requireCapability } from "@/lib/viewer.ts";

export interface OwnershipCandidate {
  id: string;
  name: string;
  username: string | null;
  current: boolean;
}

export async function readOwnershipCandidates(): Promise<OwnershipCandidate[]> {
  const viewer = await requireCapability("users.manage", "roles.manage");
  return readOnly(viewer.tenantId, async (tx) => {
    const [owner] = await tx
      .select({ userId: tenantOwners.userId })
      .from(tenantOwners)
      .where(eq(tenantOwners.tenantId, viewer.tenantId))
      .limit(1);

    const adminRoles = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, viewer.tenantId), eq(roles.tier, ADMINISTRATOR_TIER)));
    if (adminRoles.length === 0) return [];

    const rows = await tx
      .select({
        id: user.id,
        name: user.name,
        username: user.displayUsername,
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
      .where(
        and(
          eq(user.tenantId, viewer.tenantId),
          inArray(
            userRoles.roleId,
            adminRoles.map((role) => role.id),
          ),
        ),
      );

    const adminCapabilities =
      rows.length === 0
        ? []
        : await tx
            .select({ userId: userRoles.userId, capability: roleCapabilities.capability })
            .from(userRoles)
            .innerJoin(
              roles,
              and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, viewer.tenantId)),
            )
            .innerJoin(roleCapabilities, eq(roleCapabilities.roleId, roles.id))
            .where(
              and(
                eq(userRoles.tenantId, viewer.tenantId),
                inArray(
                  userRoles.userId,
                  rows.map((row) => row.id),
                ),
                inArray(roleCapabilities.capability, ["users.manage", "roles.manage"]),
              ),
            );
    const managementCaps = new Map<string, Set<string>>();
    for (const row of adminCapabilities) {
      const set = managementCaps.get(row.userId) ?? new Set<string>();
      set.add(row.capability);
      managementCaps.set(row.userId, set);
    }

    const currentDate = await tx.execute(sql`select current_date::text as today`);
    const today = String((currentDate.rows[0] as { today?: unknown } | undefined)?.today ?? "");
    const seen = new Set<string>();
    return rows
      .filter(
        (row) =>
          row.suspendedAt === null &&
          (!row.accountExpiresAt || row.accountExpiresAt > new Date()) &&
          (!row.employmentStart || row.employmentStart <= today) &&
          (!row.employmentEnd || row.employmentEnd >= today) &&
          !row.mustChangePassword &&
          managementCaps.get(row.id)?.has("users.manage") === true &&
          managementCaps.get(row.id)?.has("roles.manage") === true &&
          !seen.has(row.id) &&
          seen.add(row.id),
      )
      .map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        current: row.id === owner?.userId,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  });
}
