"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { account, session, user, userRoles } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { isAuthId } from "@/lib/auth-id.ts";
import { dateInTimeZone, endOfDateInTimeZone } from "@/lib/date-time.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { requireElevatedSession } from "@/lib/step-up.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { mutationAuthority } from "./user-authority.ts";

/**
 * The people who may sign in, and what each of them may do.
 *
 * ── The rule that makes `users.manage` safe to grant ────────────────────────
 *
 * Nobody may act on an account whose highest role is at or above their own
 * tier, and nobody may assign a role at or above it. Without both, `users.manage`
 * is a privilege-escalation route: the holder assigns themselves the
 * administrator role and is done. Every action below re-derives the target's
 * tier from the database and refuses — the screen greys the controls out, and a
 * greyed control is a courtesy rather than a check.
 *
 * ── Why suspending and revoking are different words ────────────────────────
 *
 * Suspension is reversible and keeps the roles; revocation destroys the
 * credential and the assignments. An administrator who confuses them either
 * locks somebody out for a morning or destroys an account they meant to pause,
 * so they are two actions with two confirmations that say what each does.
 */

/** Pausing an account, keeping its password and its roles. */
export async function suspendUser(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");
  const targetId = String(form.get("userId") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };
  if (reason.length > 200) return { ok: false, errors: { reason: "tooLong" } };

  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity) return "accountRevoked";
    if (authority.targetSuspendedAt !== null) return "accountStateChanged";

    const [updated] = await tx
      .update(user)
      .set({ suspendedAt: sql`now()`, suspendedReason: reason || null, updatedAt: sql`now()` })
      .where(
        and(
          eq(user.id, targetId),
          eq(user.tenantId, viewer.tenantId),
          sql`${user.suspendedAt} is null`,
        ),
      )
      .returning({ id: user.id });
    if (!updated) return "accountStateChanged";

    /* A suspension must invalidate already-issued access immediately. */
    await tx.delete(session).where(eq(session.userId, targetId));

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.suspend",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({ suspended: { from: false, to: true }, reason: { to: reason } }),
    });
    return null;
  });

  if (failure) return { ok: false, message: failure };
  revalidatePath("/settings/users");
  return { ok: true, message: "suspended" };
}

export async function reinstateUser(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");
  const targetId = String(form.get("userId") ?? "");

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };

  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity) return "accountRevoked";
    if (authority.targetSuspendedAt === null) return "accountStateChanged";

    const [updated] = await tx
      .update(user)
      .set({ suspendedAt: null, suspendedReason: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(user.id, targetId),
          eq(user.tenantId, viewer.tenantId),
          sql`${user.suspendedAt} is not null`,
        ),
      )
      .returning({ id: user.id });
    if (!updated) return "accountStateChanged";

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.reinstate",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({ suspended: { from: true, to: false } }),
    });
    return null;
  });

  if (failure) return { ok: false, message: failure };
  revalidatePath("/settings/users");
  return { ok: true, message: "reinstated" };
}

/**
 * Withdrawing access permanently.
 *
 * Every Better Auth identity and every role/session is destroyed, while the
 * user row stays. Keeping that row preserves the audit actor foreign key and
 * therefore attribution of historical actions. The account cannot be revived
 * by assigning roles or setting another password; a returnee gets a new account.
 */
export async function revokeUser(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");
  const targetId = String(form.get("userId") ?? "");

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };

  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity) return "accountRevoked";

    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, targetId), eq(userRoles.tenantId, viewer.tenantId)));
    await tx.delete(session).where(eq(session.userId, targetId));
    /* Delete all Better Auth identities, not just the current password account.
       That keeps the meaning of “revoke access” correct if another provider is
       introduced later. */
    await tx.delete(account).where(eq(account.userId, targetId));

    const tombstone = `revoked_${targetId}`;
    const [updated] = await tx
      .update(user)
      .set({
        suspendedAt: sql`now()`,
        suspendedReason: null,
        /* Release tenant-local and Better Auth identifiers so a replacement or
           returnee can legitimately receive the same organisational username.
           The immutable user id and display name remain for historical audit
           attribution; the revoked credential itself is already destroyed. */
        displayUsername: null,
        username: tombstone,
        email: `${targetId}@revoked.invalid`,
        emailVerified: false,
        updatedAt: sql`now()`,
      })
      .where(and(eq(user.id, targetId), eq(user.tenantId, viewer.tenantId)))
      .returning({ id: user.id });
    if (!updated) return "record.missing";

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.revoke",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({
        revoked: { from: false, to: true },
        identifiersReleased: { to: true },
      }),
    });
    return null;
  });

  if (failure) return { ok: false, message: failure };
  revalidatePath("/settings/users");
  return { ok: true, message: "revoked" };
}

/** Signing an account out of every device it is on. */
export async function signOutUser(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");
  const targetId = String(form.get("userId") ?? "");

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };

  let changed = false;
  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity) return "accountRevoked";

    const deleted = await tx
      .delete(session)
      .where(eq(session.userId, targetId))
      .returning({ id: session.id });
    if (deleted.length === 0) return null;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.sessions.revoke",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({ sessions: { from: deleted.length, to: 0 } }),
    });
    changed = true;
    return null;
  });

  if (failure) return { ok: false, message: failure };
  if (changed) revalidatePath("/settings/users");
  return { ok: true, message: "signedOut" };
}

/** Set employment and access validity without deleting the audit identity. */
export async function updateUserLifecycle(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");

  const targetId = String(form.get("userId") ?? "");
  const employmentStart = String(form.get("employmentStart") ?? "").trim() || null;
  const employmentEnd = String(form.get("employmentEnd") ?? "").trim() || null;
  const expiryDate = String(form.get("accountExpiryDate") ?? "").trim() || null;

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (employmentStart && !datePattern.test(employmentStart)) {
    return { ok: false, errors: { employmentStart: "invalidDate" } };
  }
  if (employmentEnd && !datePattern.test(employmentEnd)) {
    return { ok: false, errors: { employmentEnd: "invalidDate" } };
  }
  if (expiryDate && !datePattern.test(expiryDate)) {
    return { ok: false, errors: { accountExpiryDate: "invalidDate" } };
  }
  if (employmentStart && employmentEnd && employmentEnd < employmentStart) {
    return { ok: false, errors: { employmentEnd: "dateOrder" } };
  }
  let accountExpiresAt: Date | null = null;
  try {
    accountExpiresAt = expiryDate ? endOfDateInTimeZone(expiryDate, viewer.tenantTimezone) : null;
  } catch {
    return { ok: false, errors: { accountExpiryDate: "invalidDate" } };
  }

  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity) return "accountRevoked";

    const [before] = await tx
      .select({
        employmentStart: user.employmentStart,
        employmentEnd: user.employmentEnd,
        accountExpiresAt: user.accountExpiresAt,
      })
      .from(user)
      .where(and(eq(user.id, targetId), eq(user.tenantId, viewer.tenantId)))
      .limit(1);
    if (!before) return "record.missing";

    const changed =
      before.employmentStart !== employmentStart ||
      before.employmentEnd !== employmentEnd ||
      (before.accountExpiresAt?.getTime() ?? null) !== (accountExpiresAt?.getTime() ?? null);
    if (!changed) return null;

    await tx
      .update(user)
      .set({ employmentStart, employmentEnd, accountExpiresAt, updatedAt: new Date() })
      .where(and(eq(user.id, targetId), eq(user.tenantId, viewer.tenantId)));

    const tenantToday = dateInTimeZone(new Date(), viewer.tenantTimezone);
    const accessUnavailableNow =
      (employmentStart !== null && employmentStart > tenantToday) ||
      (employmentEnd !== null && employmentEnd < tenantToday) ||
      (accountExpiresAt !== null && accountExpiresAt <= new Date());
    if (accessUnavailableNow) await tx.delete(session).where(eq(session.userId, targetId));

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      subjectId: targetId,
      action: "users.lifecycle.update",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({
        employmentStart: { from: before.employmentStart, to: employmentStart },
        employmentEnd: { from: before.employmentEnd, to: employmentEnd },
        accountExpiresAt: {
          from: before.accountExpiresAt?.toISOString() ?? null,
          to: accountExpiresAt?.toISOString() ?? null,
        },
      }),
    });
    return null;
  });

  if (failure) return { ok: false, message: failure };
  revalidatePath("/settings/users");
  return { ok: true, message: "lifecycleSaved" };
}
