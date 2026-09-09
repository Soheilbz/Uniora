import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { account, roles, session, user, userRoles } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { ORDINARY_TIER } from "@/lib/capabilities.ts";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";

/**
 * Reading the user directory.
 *
 * Apart from the actions beside it, and not for tidiness: `users.ts` reaches
 * Better Auth to create an account and to hash a password, and importing that
 * library opens a connection pool the moment the module is loaded. Anything
 * that only wants to *read* the directory — this screen's own page, and the
 * tests that check the tier rule — would otherwise drag the whole identity
 * stack in behind it, and a test asserting «a senior may not assign the
 * administrator role» would need a database before it could even be collected.
 *
 * The same split `capabilities.ts` and `viewer.ts` already have, for the same
 * reason.
 */

export interface UserRow {
  id: string;
  name: string;
  username: string | null;
  email: string;
  standing: "active" | "scheduled" | "suspended" | "expired" | "revoked";
  suspendedReason: string | null;
  suspendedAt: Date | null;
  createdAt: Date;
  roleIds: string[];
  roleNames: string[];
  tier: number;
  devices: number;
  /** Persistent successful sign-in timestamp, independent of session retention. */
  lastLoginAt: Date | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  accountExpiresAt: Date | null;
  mustChangePassword: boolean;
  /** Whether this viewer may act on the account: strictly below their tier. */
  actionable: boolean;
  self: boolean;
}

export const USER_DIRECTORY_PAGE_SIZE = 100;

export interface UserPage {
  rows: UserRow[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface RoleChoice {
  id: string;
  name: string;
  tier: number;
  /** False where the role is at or above the viewer's tier. */
  assignable: boolean;
}

export async function readUsers(
  tenantId: string,
  viewerId: string,
  viewerTier: number,
  viewerIsOwner: boolean,
  search: string,
  requestedPage = 1,
  options: { all?: boolean } = {},
): Promise<UserPage> {
  return readOnly(tenantId, async (tx) => {
    const term = search.trim().slice(0, MAX_SEARCH_LENGTH);

    const where =
      term === ""
        ? eq(user.tenantId, tenantId)
        : and(
            eq(user.tenantId, tenantId),
            sql`app.fold_text(
              coalesce(${user.name}, '') || ' ' ||
              coalesce(${user.displayUsername}, '') || ' ' ||
              coalesce(${user.email}, '')
            ) LIKE '%' || app.fold_text(${term}) || '%'`,
          );
    const countRows = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(user)
      .where(where);
    const total = countRows[0]?.total ?? 0;
    const pageSize = options.all ? Math.max(1, total) : USER_DIRECTORY_PAGE_SIZE;
    const pages = options.all ? 1 : Math.max(1, Math.ceil(total / pageSize));
    const page = options.all ? 1 : Math.min(Math.max(1, requestedPage), pages);

    const accounts = await tx
      .select({
        id: user.id,
        name: user.name,
        username: user.displayUsername,
        email: user.email,
        suspendedAt: user.suspendedAt,
        suspendedReason: user.suspendedReason,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        employmentStart: user.employmentStart,
        employmentEnd: user.employmentEnd,
        accountExpiresAt: user.accountExpiresAt,
        mustChangePassword: user.mustChangePassword,
      })
      .from(user)
      .where(where)
      .orderBy(asc(user.name), asc(user.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    if (accounts.length === 0) {
      return { rows: [], page, pageSize, total, pages };
    }

    const ids = accounts.map((row) => row.id);

    const held = await tx
      .select({
        userId: userRoles.userId,
        roleId: roles.id,
        roleName: roles.name,
        tier: roles.tier,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          inArray(userRoles.userId, ids),
          eq(userRoles.tenantId, tenantId),
          eq(roles.tenantId, tenantId),
        ),
      );

    /*
     * Live sessions, counted from the session table directly.
     *
     * Better Auth lists sessions for the *current* account only; this screen
     * asks about somebody else's, which is a question about rows. Expired ones
     * are excluded — a session that has run out is not a device somebody is
     * signed in on, and counting it would make «خروج از همه‌ی دستگاه‌ها» look
     * like it did nothing.
     */
    const live = await tx
      .select({
        userId: session.userId,
        devices: sql<number>`count(*)`.mapWith(Number),
      })
      .from(session)
      .innerJoin(user, eq(user.id, session.userId))
      .where(
        and(
          inArray(session.userId, ids),
          eq(user.tenantId, tenantId),
          gt(session.expiresAt, sql`now()`),
        ),
      )
      .groupBy(session.userId);

    const rolesOf = new Map<string, { ids: string[]; names: string[]; tier: number }>();
    for (const row of held) {
      const entry = rolesOf.get(row.userId) ?? { ids: [], names: [], tier: ORDINARY_TIER };
      entry.ids.push(row.roleId);
      entry.names.push(row.roleName);
      entry.tier = Math.max(entry.tier, row.tier);
      rolesOf.set(row.userId, entry);
    }
    const identities = await tx
      .select({ userId: account.userId })
      .from(account)
      .where(inArray(account.userId, ids));
    const identityOf = new Set(identities.map((row) => row.userId));

    const devicesOf = new Map(live.map((row) => [row.userId, row.devices]));
    const todayResult = await tx.execute(sql`select current_date::text as today`);
    const today = String((todayResult.rows[0] as { today?: unknown } | undefined)?.today ?? "");
    const rows = accounts.map((account) => {
      const held = rolesOf.get(account.id) ?? { ids: [], names: [], tier: ORDINARY_TIER };
      /*
       * Revocation is an identity fact, not a role-count heuristic. A suspended
       * account may legitimately hold zero roles; it is revoked only when the
       * suspension is accompanied by removal of every Better Auth identity.
       */
      const revoked = account.suspendedAt !== null && !identityOf.has(account.id);
      const scheduled = account.employmentStart !== null && account.employmentStart > today;
      const expired =
        (account.accountExpiresAt !== null && account.accountExpiresAt <= new Date()) ||
        (account.employmentEnd !== null && account.employmentEnd < today);

      const standing: UserRow["standing"] = revoked
        ? "revoked"
        : account.suspendedAt
          ? "suspended"
          : expired
            ? "expired"
            : scheduled
              ? "scheduled"
              : "active";

      return {
        id: account.id,
        name: account.name,
        username: account.username,
        email: account.email.endsWith("@users.invalid") ? "" : account.email,
        standing,
        suspendedReason: account.suspendedReason,
        suspendedAt: account.suspendedAt,
        createdAt: account.createdAt,
        roleIds: held.ids,
        roleNames: held.names,
        tier: held.tier,
        devices: devicesOf.get(account.id) ?? 0,
        lastLoginAt: account.lastLoginAt,
        employmentStart: account.employmentStart,
        employmentEnd: account.employmentEnd,
        accountExpiresAt: account.accountExpiresAt,
        mustChangePassword: account.mustChangePassword,
        actionable:
          account.id !== viewerId &&
          (held.tier < viewerTier || (viewerIsOwner && held.tier === viewerTier)),
        self: account.id === viewerId,
      };
    });
    return { rows, page, pageSize, total, pages };
  });
}

export async function readAssignableRoles(
  tenantId: string,
  viewerTier: number,
  viewerIsOwner = false,
): Promise<RoleChoice[]> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({ id: roles.id, name: roles.name, tier: roles.tier })
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(sql`${roles.tier} desc`, asc(roles.name)),
  );
  return rows.map((row) => ({
    ...row,
    assignable: row.tier < viewerTier || (viewerIsOwner && row.tier === viewerTier),
  }));
}
