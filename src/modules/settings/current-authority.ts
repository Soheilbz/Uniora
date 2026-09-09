import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client.ts";
import { roleCapabilities, roles, tenantOwners, tenants, user, userRoles } from "@/db/schema.ts";
import type { Capability } from "@/lib/capabilities.ts";
import { isCapability, ORDINARY_TIER } from "@/lib/capabilities.ts";

type TenantTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CurrentTenantAuthority {
  tier: number;
  isOwner: boolean;
  capabilities: Set<Capability>;
}

/**
 * Re-derives sensitive authority from the database at the mutation boundary.
 * Request-time Viewer data remains a fast gate, but it is never the final word
 * for a privileged write because another administrator can change roles,
 * employment state or tenant lifecycle while the request is in flight.
 */
export async function currentTenantAuthority(
  tx: TenantTx,
  tenantId: string,
  viewerId: string,
  requiredCapabilities: readonly Capability[],
  options: { requireOwner?: boolean } = {},
): Promise<CurrentTenantAuthority | null> {
  const [tenant] = await tx
    .select({ status: tenants.status, provisioningStatus: tenants.provisioningStatus })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (tenant?.status !== "active" || tenant.provisioningStatus !== "active") return null;

  const [account] = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.id, viewerId),
        eq(user.tenantId, tenantId),
        sql`${user.suspendedAt} is null`,
        sql`(${user.accountExpiresAt} is null or ${user.accountExpiresAt} > now())`,
        sql`(${user.employmentStart} is null or ${user.employmentStart} <= current_date)`,
        sql`(${user.employmentEnd} is null or ${user.employmentEnd} >= current_date)`,
      ),
    )
    .limit(1);
  if (!account) return null;

  const heldRoles = await tx
    .select({ id: roles.id, tier: roles.tier })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, tenantId)))
    .where(and(eq(userRoles.userId, viewerId), eq(userRoles.tenantId, tenantId)));
  if (heldRoles.length === 0) return null;

  const heldIds = heldRoles.map((row) => row.id);
  const grants = await tx
    .select({ capability: roleCapabilities.capability })
    .from(roleCapabilities)
    .where(inArray(roleCapabilities.roleId, heldIds));
  const capabilities = new Set(grants.map((row) => row.capability).filter(isCapability));
  if (requiredCapabilities.some((capability) => !capabilities.has(capability))) return null;

  const [owner] = await tx
    .select({ userId: tenantOwners.userId })
    .from(tenantOwners)
    .where(eq(tenantOwners.tenantId, tenantId))
    .limit(1);
  const isOwner = owner?.userId === viewerId;
  if (options.requireOwner && !isOwner) return null;

  return {
    tier: heldRoles.reduce((highest, row) => Math.max(highest, row.tier), ORDINARY_TIER),
    isOwner,
    capabilities,
  };
}
