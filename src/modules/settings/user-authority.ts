import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client.ts";
import { account, roles, user, userRoles } from "@/db/schema.ts";
import { ORDINARY_TIER } from "@/lib/capabilities.ts";
import { currentTenantAuthority } from "./current-authority.ts";

type TenantTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

type MutationAuthority =
  | {
      ok: true;
      viewerTier: number;
      viewerIsOwner: boolean;
      targetSuspendedAt: Date | null;
      hasIdentity: boolean;
      credentialId: string | null;
    }
  | { ok: false; reason: "missing" | "forbidden" };

/**
 * Re-check the actor inside the same transaction as a privileged user mutation.
 * Request-level capability checks are not sufficient: roles/lifecycle can
 * change between the first read and the write.
 */
export async function currentUserManagerTier(
  tx: TenantTx,
  tenantId: string,
  viewerId: string,
): Promise<{ tier: number; isOwner: boolean } | null> {
  const authority = await currentTenantAuthority(tx, tenantId, viewerId, ["users.manage"]);
  if (!authority) return null;
  return { tier: authority.tier, isOwner: authority.isOwner };
}

export async function mutationAuthority(
  tx: TenantTx,
  tenantId: string,
  targetId: string,
  viewerId: string,
): Promise<MutationAuthority> {
  if (targetId === viewerId) return { ok: false, reason: "forbidden" };

  const viewerAuthority = await currentUserManagerTier(tx, tenantId, viewerId);
  if (viewerAuthority === null) return { ok: false, reason: "forbidden" };

  const [target] = await tx
    .select({ id: user.id, suspendedAt: user.suspendedAt })
    .from(user)
    .where(and(eq(user.id, targetId), eq(user.tenantId, tenantId)))
    .limit(1);
  if (!target) return { ok: false, reason: "missing" };

  const targetRoles = await tx
    .select({ tier: roles.tier })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(userRoles.userId, targetId),
        eq(userRoles.tenantId, tenantId),
        eq(roles.tenantId, tenantId),
      ),
    );
  const targetTier = targetRoles.reduce(
    (highest, row) => Math.max(highest, row.tier),
    ORDINARY_TIER,
  );
  if (
    targetTier > viewerAuthority.tier ||
    (targetTier === viewerAuthority.tier && !viewerAuthority.isOwner)
  ) {
    return { ok: false, reason: "forbidden" };
  }

  const identities = await tx
    .select({ id: account.id, providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, targetId));
  const credential = identities.find((identity) => identity.providerId === "credential");

  return {
    ok: true,
    viewerTier: viewerAuthority.tier,
    viewerIsOwner: viewerAuthority.isOwner,
    targetSuspendedAt: target.suspendedAt,
    hasIdentity: identities.length > 0,
    credentialId: credential?.id ?? null,
  };
}
