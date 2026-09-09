import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import {
  calendarSubscriptionTokens,
  institutions,
  roleCapabilities,
  roles,
  user,
  userRoles,
} from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { type Capability, isCapability, type Viewer } from "@/lib/capabilities.ts";

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function listCalendarSubscriptions(viewer: Viewer) {
  return readOnly(viewer.tenantId, (tx) =>
    tx
      .select({
        id: calendarSubscriptionTokens.id,
        name: calendarSubscriptionTokens.name,
        tokenPrefix: calendarSubscriptionTokens.tokenPrefix,
        expiresAt: calendarSubscriptionTokens.expiresAt,
        lastUsedAt: calendarSubscriptionTokens.lastUsedAt,
        revokedAt: calendarSubscriptionTokens.revokedAt,
        createdAt: calendarSubscriptionTokens.createdAt,
      })
      .from(calendarSubscriptionTokens)
      .where(eq(calendarSubscriptionTokens.userId, viewer.userId))
      .orderBy(desc(calendarSubscriptionTokens.createdAt)),
  );
}

export async function createCalendarSubscription(
  viewer: Viewer,
  input: { name: string; expiresAt?: Date | null },
): Promise<{ id: string; token: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error("invalid calendar subscription name");
  if (input.expiresAt && input.expiresAt <= new Date())
    throw new Error("calendar subscription expiry must be in the future");
  const token = randomBytes(32).toString("base64url");
  const digest = hashToken(token);
  const prefix = token.slice(0, 8);
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .insert(calendarSubscriptionTokens)
      .values({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        name,
        tokenHash: digest,
        tokenPrefix: prefix,
        expiresAt: input.expiresAt ?? null,
      })
      .returning({ id: calendarSubscriptionTokens.id });
    if (!row) throw new Error("failed to create calendar subscription");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "calendar.subscription.create",
      entityType: "calendar_subscription",
      entityId: row.id,
      changes: JSON.stringify({
        name,
        tokenPrefix: prefix,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      }),
    });
    return { id: row.id, token };
  });
}

export async function revokeCalendarSubscription(viewer: Viewer, id: string): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(calendarSubscriptionTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(calendarSubscriptionTokens.id, id),
          eq(calendarSubscriptionTokens.userId, viewer.userId),
          isNull(calendarSubscriptionTokens.revokedAt),
        ),
      )
      .returning({ id: calendarSubscriptionTokens.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "calendar.subscription.revoke",
      entityType: "calendar_subscription",
      entityId: id,
    });
    return true;
  });
}

/** Resolves a bearer token through a deliberately narrow SECURITY DEFINER
 * function, then re-derives the user's current calendar entitlement under RLS. */
export async function viewerForCalendarSubscription(token: string): Promise<Viewer | null> {
  if (token.length < 32 || token.length > 200) return null;
  const digest = hashToken(token);
  const resolved = await db().execute(
    sql`select * from app.resolve_calendar_subscription(${digest})`,
  );
  const row = resolved.rows[0] as { tenant_id?: unknown; user_id?: unknown } | undefined;
  if (!row?.tenant_id || !row.user_id) return null;
  const tenantId = String(row.tenant_id);
  const userId = String(row.user_id);
  return readOnly(tenantId, async (tx) => {
    const [account] = await tx
      .select({
        name: user.name,
        suspendedAt: user.suspendedAt,
        expiresAt: user.accountExpiresAt,
        employmentStart: user.employmentStart,
        employmentEnd: user.employmentEnd,
      })
      .from(user)
      .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
      .limit(1);
    const today = new Date().toISOString().slice(0, 10);
    if (
      !account ||
      account.suspendedAt ||
      (account.expiresAt && account.expiresAt <= new Date()) ||
      (account.employmentStart && account.employmentStart > today) ||
      (account.employmentEnd && account.employmentEnd < today)
    )
      return null;
    const held = await tx
      .select({ roleId: roles.id, tier: roles.tier, name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, tenantId),
          eq(roles.tenantId, tenantId),
        ),
      );
    const grants = held.length
      ? await tx
          .select({ capability: roleCapabilities.capability })
          .from(roleCapabilities)
          .where(
            inArray(
              roleCapabilities.roleId,
              held.map((item) => item.roleId),
            ),
          )
      : [];
    const capabilities = [
      ...new Set(grants.map((item) => item.capability).filter(isCapability)),
    ] as Capability[];
    if (!capabilities.includes("calendar.view")) return null;
    const [institution] = await tx
      .select({
        timezone: institutions.timezone,
        passwordMinLength: institutions.passwordMinLength,
      })
      .from(institutions)
      .limit(1);
    const highest = held.reduce((best, item) => (item.tier > best.tier ? item : best), {
      tier: 0,
      name: null as string | null,
      roleId: "",
    });
    return {
      userId,
      name: account.name,
      tenantId,
      capabilities,
      roleName: highest.name,
      tier: highest.tier,
      mustChangePassword: false,
      mfaEnabled: false,
      mfaVerified: false,
      requireMfa: false,
      tenantTimezone: institution?.timezone ?? "UTC",
      tenantPasswordMinLength: institution?.passwordMinLength ?? 12,
      isTenantOwner: false,
    };
  });
}
