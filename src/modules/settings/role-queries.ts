import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { roleCapabilities, roles, userRoles } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { type Capability, isCapability } from "@/lib/capabilities.ts";

/**
 * Reading the roles and what each one carries.
 *
 * Apart from the actions beside it for the reason `user-queries.ts` is: the
 * actions reach `requireCapability`, which reaches the session, which loads
 * Better Auth and opens a connection pool at import time. A test asserting the
 * tier rule should not need an identity stack to be collected.
 */

export interface RoleView {
  id: string;
  key: string;
  name: string;
  tier: number;
  isSystem: boolean;
  capabilities: Capability[];
  holders: number;
  /** Whether this viewer may edit it: below their tier, and not a system role. */
  editable: boolean;
}

export async function readRoles(tenantId: string, viewerTier: number): Promise<RoleView[]> {
  return readOnly(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        tier: roles.tier,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(sql`${roles.tier} desc`, asc(roles.name));

    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);

    /*
     * Two aggregates rather than two joins onto one query.
     *
     * A role has many capabilities and many holders; joining both at once
     * multiplies them — a role with twelve capabilities held by five people
     * reports sixty of each. The same reason the workshop register counts with
     * subqueries.
     */
    const granted = await tx
      .select({ roleId: roleCapabilities.roleId, capability: roleCapabilities.capability })
      .from(roleCapabilities)
      .innerJoin(roles, eq(roles.id, roleCapabilities.roleId))
      .where(and(inArray(roleCapabilities.roleId, ids), eq(roles.tenantId, tenantId)));

    const counted = await tx
      .select({ roleId: userRoles.roleId, holders: sql<number>`count(*)`.mapWith(Number) })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          inArray(userRoles.roleId, ids),
          eq(userRoles.tenantId, tenantId),
          eq(roles.tenantId, tenantId),
        ),
      )
      .groupBy(userRoles.roleId);

    const byRole = new Map<string, Capability[]>();
    for (const row of granted) {
      if (!isCapability(row.capability)) continue;
      const held = byRole.get(row.roleId) ?? [];
      held.push(row.capability);
      byRole.set(row.roleId, held);
    }
    const holderOf = new Map(counted.map((row) => [row.roleId, row.holders]));

    return rows.map((row) => ({
      ...row,
      capabilities: byRole.get(row.id) ?? [],
      holders: holderOf.get(row.id) ?? 0,
      /*
       * A system role is not editable by anybody, at any tier.
       *
       * It is what the installation was seeded with and what the first
       * administrator signs in as. An administrator who removed `users.manage`
       * from it — by accident, in a hurry — would have locked the institution
       * out of its own account administration with no way back in through the
       * interface.
       */
      editable: !row.isSystem && row.tier < viewerTier,
    }));
  });
}
