import { desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { loginAttempts, platformOperators, session, tenants, user } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuthAuditEvent } from "@/lib/auth-audit-writer.ts";
import { DEFAULT_LOCKOUT, isLocked, type LockoutPolicy } from "./lockout.ts";
import { PASSWORD_MAXIMUM_LENGTH } from "./password-policy.ts";
import { LOGIN_IDENTIFIER_MAXIMUM_LENGTH } from "./username-policy.ts";

/**
 * The per-account brake on password guessing, wired around Better Auth's
 * sign-in endpoint as a before/after pair.
 *
 * ── Why this is built rather than configured ────────────────────────────────
 *
 * Better Auth ships a rate limiter, and it is keyed by the caller's address —
 * the same axis a reverse proxy already covers. It has no account lockout. An
 * address limiter cannot answer the attack this exists for: a guesser rotating
 * addresses is a new caller every time, while the account under attack
 * accumulates nothing anywhere. So the account axis is counted here, in
 * PostgreSQL, keyed by the account.
 *
 * ── What counts, and what must not ──────────────────────────────────────────
 *
 * Only a rejected *credential* — the 401 — because that is the one response an
 * attacker learns from. A malformed body, a throttled request, a server fault:
 * none verified a password, so none may cost the account's owner an attempt.
 *
 * And a refusal issued by this guard itself must never be booked as another
 * failure. It looks identical to a bad credential from the outside (which is
 * the point, below), so without that exception every refused request would
 * extend the cooldown and recreate the very lockout-as-denial-of-service the
 * one-minute policy exists to avoid.
 *
 * ── Why the refusal is indistinguishable from a wrong password ──────────────
 *
 * A distinct «this account is locked» response makes the username itself
 * observable: after enough guesses an existing account changes response class
 * while an invented one does not. It also tells an attacker precisely when they
 * have succeeded at denying somebody service. The ledger is the evidence, and
 * it is server-side; the public answer stays the shape Better Auth uses for a
 * bad credential.
 */

/** The sign-in endpoints this deployment exposes. */
const SIGN_IN_PATHS = new Set(["/sign-in/username", "/sign-in/email"]);

export function isSignInPath(path: string): boolean {
  return SIGN_IN_PATHS.has(path);
}

/** The username or e-mail a sign-in body names, or null when it names none. */
export function signInIdentifier(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const { username, email } = body as Record<string, unknown>;
  const identifier = typeof username === "string" ? username : email;
  if (typeof identifier !== "string") return null;
  const normalized = identifier.trim().toLowerCase();
  return normalized !== "" && normalized.length <= LOGIN_IDENTIFIER_MAXIMUM_LENGTH
    ? normalized
    : null;
}

/** A request that actually supplied credentials worth counting or clearing. */
export function isSignInCredentialAttempt(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  const payload = body as Record<string, unknown>;
  const identifier = signInIdentifier(body);
  const password = payload.password;
  return (
    identifier !== null &&
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= PASSWORD_MAXIMUM_LENGTH
  );
}

/**
 * The account a typed identifier names, or null.
 *
 * One query over both columns rather than two in sequence — this runs on the
 * hot path of every sign-in, including every failed one, which is exactly the
 * traffic somebody attacking the deployment supplies.
 */
async function accountFor(identifier: string) {
  const [found] = await db()
    .select({
      id: user.id,
      tenantId: user.tenantId,
      suspendedAt: user.suspendedAt,
      accountExpiresAt: user.accountExpiresAt,
      employmentStart: user.employmentStart,
      employmentEnd: user.employmentEnd,
      platformOperatorId: platformOperators.userId,
      tenantStatus: tenants.status,
      tenantProvisioningStatus: tenants.provisioningStatus,
    })
    .from(user)
    .leftJoin(tenants, eq(tenants.id, user.tenantId))
    .leftJoin(platformOperators, eq(platformOperators.userId, user.id))
    .where(or(eq(user.username, identifier), eq(user.email, identifier)))
    .limit(1);
  return found ?? null;
}

/**
 * Reads one account's ledger, inside its university's scope.
 *
 * The caller supplies the tenant because the lookup that found the account is
 * the thing that learned it — a pre-auth query has no context of its own.
 * Scoped here rather than read bare so the policy on `login_attempts` (see
 * `0001_row_level_security.sql`) can hold without an exception carved out for
 * this file: a forgotten scope now fails closed like everywhere else.
 */
/**
 * Platform operators are deliberately tenantless. The login-attempt RLS policy
 * has a narrow tenantless branch for rows whose account is registered in
 * `platform_operators`, and only while no tenant context is set. Tenant accounts
 * still call `app.current_tenant()` and therefore keep the original fail-closed
 * behavior when a scope is forgotten.
 */
async function platformLedgerFor(userId: string) {
  const [row] = await db()
    .select({
      failedCount: loginAttempts.failedCount,
      lastFailedAt: loginAttempts.lastFailedAt,
      lockedUntil: loginAttempts.lockedUntil,
    })
    .from(loginAttempts)
    .where(eq(loginAttempts.userId, userId))
    .limit(1);
  return row ?? null;
}

async function ledgerFor(tenantId: string, userId: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        failedCount: loginAttempts.failedCount,
        lastFailedAt: loginAttempts.lastFailedAt,
        lockedUntil: loginAttempts.lockedUntil,
      })
      .from(loginAttempts)
      .where(eq(loginAttempts.userId, userId))
      .limit(1);
    const currentDate = await tx.execute(sql`select current_date::text as today`);
    return {
      ledger: row ?? null,
      today: String((currentDate.rows[0] as { today?: unknown } | undefined)?.today ?? ""),
    };
  });
}

/**
 * Whether this sign-in must be refused before any password is verified.
 *
 * Returns a plain boolean rather than throwing, so the caller decides what a
 * refusal looks like — and so this can be reasoned about without knowing
 * Better Auth's error types.
 */
export async function shouldRefuse(body: unknown, now = new Date()): Promise<boolean> {
  const identifier = signInIdentifier(body);
  if (!identifier) return false;
  const account = await accountFor(identifier);
  if (account?.platformOperatorId) {
    if (
      account.suspendedAt !== null ||
      (account.accountExpiresAt && account.accountExpiresAt <= now)
    ) {
      return true;
    }
    return isLocked(await platformLedgerFor(account.id), now);
  }
  if (!account?.tenantId) return false;
  if (
    account.tenantStatus !== "active" ||
    account.tenantProvisioningStatus !== "active" ||
    account.suspendedAt !== null
  )
    return true;
  if (account.accountExpiresAt && account.accountExpiresAt <= now) return true;
  const state = await ledgerFor(account.tenantId, account.id);
  if (account.employmentStart && account.employmentStart > state.today) return true;
  if (account.employmentEnd && account.employmentEnd < state.today) return true;
  return isLocked(state.ledger, now);
}

/**
 * Books the outcome of a sign-in against the account's ledger.
 *
 * On success the row is deleted, which is what lets somebody who mistyped four
 * times sign in on the fifth without carrying debt into next week.
 */
export async function recordOutcome(
  body: unknown,
  failed: boolean,
  now = new Date(),
  policy: LockoutPolicy = DEFAULT_LOCKOUT,
): Promise<void> {
  const identifier = signInIdentifier(body);
  if (!identifier) return;
  const account = await accountFor(identifier);

  if (account?.platformOperatorId) {
    if (
      account.suspendedAt !== null ||
      (account.accountExpiresAt && account.accountExpiresAt <= now)
    ) {
      return;
    }

    if (!failed) {
      await db().transaction(async (tx) => {
        await tx.delete(loginAttempts).where(eq(loginAttempts.userId, account.id));
        const [latest] = await tx
          .select({ id: session.id, ipAddress: session.ipAddress, userAgent: session.userAgent })
          .from(session)
          .where(eq(session.userId, account.id))
          .orderBy(desc(session.createdAt))
          .limit(1);
        await tx
          .update(user)
          .set({
            lastLoginAt: now,
            lastLoginIp: latest?.ipAddress ?? null,
            lastLoginUserAgent: latest?.userAgent ?? null,
            updatedAt: now,
          })
          .where(eq(user.id, account.id));
      });
      return;
    }

    const previous = await platformLedgerFor(account.id);
    if (isLocked(previous, now)) return;
    const windowStart = new Date(now.getTime() - policy.windowMs);
    const cooldownEnd = new Date(now.getTime() + policy.cooldownMs);
    const nextCount = sql<number>`case
      when ${loginAttempts.lastFailedAt} is null
        or ${loginAttempts.lastFailedAt} < ${windowStart}::timestamptz
      then 1
      else ${loginAttempts.failedCount} + 1 end`;

    await db()
      .insert(loginAttempts)
      .values({
        userId: account.id,
        failedCount: 1,
        lastFailedAt: now,
        lockedUntil: policy.attempts <= 1 ? cooldownEnd : null,
      })
      .onConflictDoUpdate({
        target: loginAttempts.userId,
        set: {
          failedCount: nextCount,
          lastFailedAt: now,
          lockedUntil: sql`case when ${nextCount} >= ${policy.attempts} then ${cooldownEnd}::timestamptz else null end`,
        },
      });
    return;
  }

  /*
   * An identifier matching no account is not counted and not audited.
   *
   * Not counted, because there is nothing to lock and the table would otherwise
   * grow with an attacker's imagination. Not audited, because `audit_log` has a
   * `tenant_id` that cannot be null — every row belongs to one university, and
   * row-level security is built on that — so a tenantless attempt has no row it
   * could honestly occupy and would be invisible on the audit screen anyway.
   *
   * A suspended account is also not counted or audited on a failed attempt; the
   * refusal happens before password verification.
   */
  if (
    !account?.tenantId ||
    account.tenantStatus !== "active" ||
    account.tenantProvisioningStatus !== "active" ||
    account.suspendedAt !== null
  )
    return;
  const tenantId = account.tenantId;
  const lifecycle = await ledgerFor(tenantId, account.id);
  if (account.accountExpiresAt && account.accountExpiresAt <= now) return;
  if (account.employmentStart && account.employmentStart > lifecycle.today) return;
  if (account.employmentEnd && account.employmentEnd < lifecycle.today) return;

  if (!failed) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(loginAttempts).where(eq(loginAttempts.userId, account.id));
      const [latest] = await tx
        .select({ id: session.id, ipAddress: session.ipAddress, userAgent: session.userAgent })
        .from(session)
        .where(eq(session.userId, account.id))
        .orderBy(desc(session.createdAt))
        .limit(1);
      await tx
        .update(user)
        .set({
          lastLoginAt: now,
          lastLoginIp: latest?.ipAddress ?? null,
          lastLoginUserAgent: latest?.userAgent ?? null,
          updatedAt: now,
        })
        .where(eq(user.id, account.id));
      await writeAuthAuditEvent(tx, {
        tenantId,
        actorId: account.id,
        subjectId: account.id,
        action: "auth.login.success",
        entityType: "user",
        entityId: account.id,
        sessionId: latest?.id ?? null,
        ipAddress: latest?.ipAddress ?? null,
        userAgent: latest?.userAgent ?? null,
        outcome: "success",
      });
    });
    return;
  }

  /*
   * A refusal this guard issued is not another failed verification — see the
   * note at the top. Checked here rather than passed down from the before-hook
   * because the after-hook sees only the response, and the response is
   * deliberately identical either way.
   */
  const previous = lifecycle;
  if (isLocked(previous.ledger, now)) return;

  /*
   * The increment happens in SQL, not in JavaScript.
   *
   * Reading the count here, adding one and writing the sum back loses attempts
   * under concurrency: two simultaneous failures both read 4 and both write 5,
   * and the brake trips one attempt later than the office believes it does.
   * The arithmetic `afterFailure` does is expressed instead as a `CASE` over
   * the row's own current value inside the upsert, so two writers serialize on
   * the row lock and each attempt lands. The returned row says what actually
   * stuck, which is what the audit entries below report.
   */
  const windowStart = new Date(now.getTime() - policy.windowMs);
  const cooldownEnd = new Date(now.getTime() + policy.cooldownMs);

  /*
   * `::timestamptz` on every date bound inside a raw `sql` template.
   *
   * A Date bound through a typed column path arrives as a timestamp; bound
   * through a raw template it arrives as *text*, and PostgreSQL refuses the
   * comparison and the assignment outright — every wrong password was a 500,
   * found by the end-to-end suite and by nothing before it.
   */

  /* One more failure: a fresh streak when the last was outside the window. */
  const nextCount = sql<number>`case
    when ${loginAttempts.lastFailedAt} is null
      or ${loginAttempts.lastFailedAt} < ${windowStart}::timestamptz
    then 1
    else ${loginAttempts.failedCount} + 1 end`;

  const [written] = await withTenant(tenantId, (tx) =>
    tx
      .insert(loginAttempts)
      .values({
        userId: account.id,
        failedCount: 1,
        lastFailedAt: now,
        lockedUntil: policy.attempts <= 1 ? cooldownEnd : null,
      })
      .onConflictDoUpdate({
        target: loginAttempts.userId,
        set: {
          failedCount: nextCount,
          lastFailedAt: now,
          lockedUntil: sql`case when ${nextCount} >= ${policy.attempts} then ${cooldownEnd}::timestamptz else null end`,
        },
      })
      .returning({
        failedCount: loginAttempts.failedCount,
        lockedUntil: loginAttempts.lockedUntil,
      }),
  );

  const failedCount = written?.failedCount ?? 1;
  const tripped = written?.lockedUntil !== null && written?.lockedUntil !== undefined;

  /*
   * The attempt on the trail, and the lockout as its own event.
   *
   * «Somebody was locked out» is a question an office asks separately from the
   * attempts that caused it — which is why `auth.lockout` is one of the actions
   * the audit screen draws in warning colour. Neither row carries the password
   * or any hint of how close a wrong one was.
   */
  await withTenant(tenantId, async (tx) => {
    await writeAuthAuditEvent(tx, {
      tenantId,
      actorId: null,
      subjectId: account.id,
      action: "auth.login.failed",
      entityType: "user",
      entityId: account.id,
      changes: JSON.stringify({ attempt: { from: null, to: failedCount } }),
      outcome: "failure",
    });

    if (tripped) {
      await writeAuthAuditEvent(tx, {
        tenantId,
        actorId: null,
        subjectId: account.id,
        action: "auth.lockout",
        entityType: "user",
        entityId: account.id,
        changes: JSON.stringify({
          failedAttempts: { from: null, to: failedCount },
          cooldownSeconds: { from: null, to: Math.round(policy.cooldownMs / 1000) },
        }),
        outcome: "failure",
      });
    }
  });
}
