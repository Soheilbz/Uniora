import { and, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client.ts";
import {
  session as authSession,
  institutions,
  roleCapabilities,
  roles,
  tenantOwners,
  tenants,
  user,
  userRoles,
} from "@/db/schema.ts";
import { readOnly, TenantUnavailableError } from "@/db/tenant.ts";
import { type Capability, can, isCapability, ORDINARY_TIER, type Viewer } from "./capabilities";
import { dateInTimeZone } from "./date-time";
import { isTenantFeatureEnabled } from "./features";
import { type ModuleDef, moduleFor } from "./modules";
import { currentSession } from "./session";

export type { Viewer } from "./capabilities";
export { can } from "./capabilities";

/**
 * Who is asking, which institution they belong to, and what they may do.
 *
 * ── Resolved on the server, every request, from the database ─────────────────
 *
 * Capabilities are read from the database on every request rather than copied
 * into the session. When an administrator withdraws a permission, the next
 * request observes the change immediately.
 *
 * The cost is one query per request, which `cache()` collapses to one per
 * request no matter how many components ask. That query is two joins on
 * indexed columns returning a handful of rows; at this size it is cheaper than
 * the alternative's failure mode.
 */

/**
 * The viewer, or the sign-in page.
 *
 * A signed-in account with no tenant is treated as not signed in, and that is a
 * security decision rather than tidiness: `tenantId` is what scopes every query
 * to one university, so a request that reached the database without one would
 * be a request with no scope at all. Sending them back to sign in is the safe
 * end of that.
 */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  const session = await currentSession();
  const account = session?.user as
    | { id: string; name: string; tenantId?: string | null }
    | undefined;

  if (!account?.id || !account.tenantId) return null;
  const userId = account.id;
  const tenantId = account.tenantId;

  const [tenant] = await db()
    .select({ status: tenants.status, provisioningStatus: tenants.provisioningStatus })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (tenant?.status !== "active" || tenant?.provisioningStatus !== "active") return null;

  /*
   * Scoped to the tenant on the session, like every other read.
   *
   * It would have been easy to argue this one out of it — "the authorisation
   * tables are not institutional data" — and that argument is wrong. Roles are
   * per-institution, and an unscoped read here would resolve a person's
   * capabilities against every university's roles at once. The tenant is not
   * circular: it comes from the signed session cookie, before this query, and
   * this query decides only what the person may *do* within it.
   *
   * Read-only, because resolving who somebody is must never be able to write.
   */
  const resolved = await (async () => {
    try {
      return await readOnly(tenantId, async (tx) => {
        const [usr] = await tx
          .select({
            suspendedAt: user.suspendedAt,
            mustChangePassword: user.mustChangePassword,
            accountExpiresAt: user.accountExpiresAt,
            employmentStart: user.employmentStart,
            employmentEnd: user.employmentEnd,
          })
          .from(user)
          .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
          .limit(1);
        const [institution] = await tx
          .select({
            timezone: institutions.timezone,
            sessionHours: institutions.sessionHours,
            passwordMinLength: institutions.passwordMinLength,
          })
          .from(institutions)
          .where(eq(institutions.tenantId, tenantId))
          .limit(1);
        const [ownership] = await tx
          .select({ userId: tenantOwners.userId })
          .from(tenantOwners)
          .where(eq(tenantOwners.tenantId, tenantId))
          .limit(1);
        const sessionId = session?.session?.id;
        const [securitySession] = sessionId
          ? await tx
              .select({
                createdAt: authSession.createdAt,
              })
              .from(authSession)
              .where(and(eq(authSession.id, sessionId), eq(authSession.userId, userId)))
              .limit(1)
          : [];
        /* Tier and role identity come from role membership itself, not from the
       capability join. A role with zero capabilities is still a role and must
       not make its holder appear artificially lower-tier. */
        const heldRoles = await tx
          .select({ id: roles.id, tier: roles.tier, roleName: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(userRoles.userId, userId),
              eq(userRoles.tenantId, tenantId),
              eq(roles.tenantId, tenantId),
            ),
          );
        const granted = heldRoles.length
          ? await tx
              .select({ capability: roleCapabilities.capability })
              .from(roleCapabilities)
              .where(
                inArray(
                  roleCapabilities.roleId,
                  heldRoles.map((row) => row.id),
                ),
              )
          : [];
        return {
          usr,
          heldRoles,
          granted,
          tenantTimezone: institution?.timezone ?? "UTC",
          tenantPasswordMinLength: institution?.passwordMinLength ?? 12,
          sessionHours: institution?.sessionHours ?? 8,
          isTenantOwner: ownership?.userId === userId,
          sessionCreatedAt: securitySession?.createdAt ?? null,
        };
      });
    } catch (error) {
      if (error instanceof TenantUnavailableError) return null;
      throw error;
    }
  })();
  if (!resolved) return null;
  const {
    usr,
    heldRoles,
    granted,
    tenantTimezone,
    tenantPasswordMinLength,
    sessionHours,
    isTenantOwner,
    sessionCreatedAt,
  } = resolved;

  if (!usr || usr.suspendedAt !== null) return null;
  const now = new Date();
  if (
    sessionCreatedAt &&
    sessionCreatedAt.getTime() + sessionHours * 60 * 60 * 1000 <= now.getTime()
  ) {
    return null;
  }
  if (usr.accountExpiresAt && usr.accountExpiresAt <= now) return null;
  const tenantToday = dateInTimeZone(now, tenantTimezone);
  if (usr.employmentStart && usr.employmentStart > tenantToday) return null;
  if (usr.employmentEnd && usr.employmentEnd < tenantToday) return null;

  const capabilities = [...new Set(granted.map((row) => row.capability).filter(isCapability))];
  const tier = heldRoles.reduce((highest, row) => Math.max(highest, row.tier), ORDINARY_TIER);
  /*
   * The name of a role at the top tier. Somebody may hold several; the one
   * displayed is the one that explains what they can do, which is the highest.
   */
  const roleName = heldRoles.find((row) => row.tier === tier)?.roleName ?? null;

  return {
    userId,
    name: account.name,
    tenantId,
    capabilities,
    roleName,
    tier,
    mustChangePassword: usr.mustChangePassword,
    /* Tenant accounts intentionally do not participate in the platform MFA
       ceremony. MFA is reserved for the tenantless platform operator account;
       keeping this policy at the viewer boundary prevents a stale database
       flag or institution setting from redirecting ordinary users to a setup
       or challenge screen. */
    mfaEnabled: false,
    mfaVerified: false,
    requireMfa: false,
    tenantTimezone,
    tenantPasswordMinLength,
    isTenantOwner,
  };
});

/** The current request's usable viewer, or the sign-in page. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

/**
 * The same check, as a gate.
 *
 * Throws to the `forbidden` boundary rather than returning false, because the
 * calling code is a page or a Server Action and the only correct thing to do
 * with a refused permission there is stop. A guard that returns a boolean is a
 * guard somebody forgets to read.
 */
export async function requireCapability(...required: Capability[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!can(viewer, ...required)) redirect("/forbidden");
  return viewer;
}

/**
 * Open a module, or refuse it — the gate every screen begins with.
 *
 * Routing the check through the registry rather than writing
 * `requireCapability("students.view")` at the top of each page means the sidebar
 * and the page read the same row. Two lists of "what this screen needs" drift,
 * and they drift in a predictable direction: somebody adds a capability to the
 * menu entry, the page keeps the old one, and the screen disappears from the
 * menu while remaining perfectly reachable by address.
 *
 * `notFound` for an unknown path rather than a thrown error, because that is
 * only ever a programming mistake — a route file naming a path the registry has
 * never heard of — and it should look like the missing page it is.
 */
export async function requireModule(path: string): Promise<{ module: ModuleDef; viewer: Viewer }> {
  const module = moduleFor(path);
  if (!module) notFound();
  const viewer = await requireCapability(...[module.capability ?? []].flat());
  if (module.feature && !(await isTenantFeatureEnabled(viewer.tenantId, module.feature)))
    notFound();
  return { module, viewer };
}
