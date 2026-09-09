"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { session, user } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { auth } from "@/lib/auth.ts";
import { isAuthId } from "@/lib/auth-id.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "@/lib/password-policy.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import {
  clearSecurityFailures,
  currentSecuritySessionId,
  recordSecurityFailure,
  securityAttemptLocked,
} from "@/lib/security-attempt.ts";
import { requireViewer } from "@/lib/viewer.ts";

/**
 * The account, as its holder may change it.
 *
 * Two things and no more: the name they are shown under, and their password.
 * Everything else about an account — the username it signs in with, the roles
 * it holds, whether it is suspended — belongs to whoever administers accounts.
 * Somebody who could edit their own would be somebody who could rename
 * themselves out of an audit trail, or grant themselves a capability.
 */

/**
 * The shortest password this installation accepts when somebody changes their
 * own.
 *
 * New and changed passwords use the same policy as administrator-issued
 * passwords, so a weaker credential cannot be introduced through the profile
 * screen.
 */
const SELF_PASSWORD_MINIMUM = PASSWORD_MINIMUM_LENGTH;

export async function saveDisplayName(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const name = String(form.get("name") ?? "").trim();

  if (name === "") return { ok: false, errors: { name: "required" } };
  if (name.length > 120) return { ok: false, errors: { name: "tooLong" } };

  await withTenant(viewer.tenantId, async (tx) => {
    /*
     * Scoped by tenant as well as by id, though the id alone is unique.
     *
     * The id comes from the session and is already this person's — but a write
     * that names only a primary key is a write that would cross the boundary if
     * that key ever came from somewhere else. Every statement in this
     * application carries its scope, and the one that edits an account is not
     * where to start making exceptions.
     */
    const [current] = await tx
      .select({ name: user.name })
      .from(user)
      .where(and(eq(user.id, viewer.userId), eq(user.tenantId, viewer.tenantId)))
      .limit(1);
    if (!current) return;
    if (current.name === name) return;

    const [updated] = await tx
      .update(user)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(user.id, viewer.userId), eq(user.tenantId, viewer.tenantId)))
      .returning({ id: user.id });
    if (!updated) return;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.update",
      entityType: "account",
      entityId: viewer.userId,
      changes: JSON.stringify({ name: { from: current.name, to: name } }),
    });
  });

  revalidatePath("/settings");
  return { ok: true, message: "saved" };
}

/**
 * Changing one's own password.
 *
 * Through Better Auth rather than by writing the hash: the library owns the
 * algorithm and its parameters, and a second place that knows how to hash a
 * password is a second place to update when those change — which is exactly the
 * update nobody remembers to make.
 *
 * The current password is required, and that is not a formality. A session left
 * open on a shared machine is the ordinary way an account is taken over in an
 * office, and without this the next person to sit down can lock the owner out
 * in two clicks.
 */
export async function changePassword(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();

  const current = String(form.get("currentPassword") ?? "");
  const next = String(form.get("newPassword") ?? "");
  const again = String(form.get("confirmPassword") ?? "");

  const errors: Record<string, string> = {};
  if (current === "") errors.currentPassword = "required";
  if (current.length > PASSWORD_MAXIMUM_LENGTH) errors.currentPassword = "passwordTooLong";
  if (next.length < Math.max(SELF_PASSWORD_MINIMUM, viewer.tenantPasswordMinLength))
    errors.newPassword = "passwordTooShort";
  if (next.length > PASSWORD_MAXIMUM_LENGTH) errors.newPassword = "passwordTooLong";
  if (next !== again) errors.confirmPassword = "passwordMismatch";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const sessionId = await currentSecuritySessionId();
  if (await securityAttemptLocked(viewer.tenantId, viewer.userId, sessionId)) {
    return { ok: false, errors: { currentPassword: "securityLocked" } };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: current,
        newPassword: next,
        /*
         * Other sessions are ended.
         *
         * Somebody changing their password on a shared machine is usually
         * changing it *because* of that machine. Leaving the other sessions
         * alive keeps open the thing they are trying to close.
         */
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch {
    /* The current-password proof shares the same per-session brake as MFA.
       A stolen bearer session must not become an unlimited offline-like
       password oracle through this Server Action. */
    const state = await recordSecurityFailure(
      viewer.tenantId,
      viewer.userId,
      sessionId,
      "auth.password.reauth_failed",
    );
    return {
      ok: false,
      errors: { currentPassword: state === "locked" ? "securityLocked" : "passwordWrong" },
    };
  }
  await clearSecurityFailures(viewer.tenantId, viewer.userId, sessionId);

  await withTenant(viewer.tenantId, async (tx) => {
    const [changed] = await tx
      .update(user)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(and(eq(user.id, viewer.userId), eq(user.tenantId, viewer.tenantId)))
      .returning({ id: user.id });
    if (changed) {
      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        subjectId: viewer.userId,
        action: "auth.password.changed",
        entityType: "account",
        entityId: viewer.userId,
        changes: JSON.stringify({ mustChangePassword: { to: false } }),
      });
    }
  });

  revalidatePath("/settings");
  return { ok: true, message: "passwordChanged" };
}

/** Signing one device out, from the list of them. */
export async function revokeDevice(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const id = String(form.get("id") ?? "");
  if (!isAuthId(id)) return { ok: false, message: "saveFailed" };

  /* The current device deliberately has no revoke control. Enforce the same
     rule in the action so a forged form cannot turn this endpoint into a second
     sign-out path with different cookie semantics. */
  const currentSessionId = await currentSecuritySessionId();
  if (id === currentSessionId) return { ok: false, message: "saveFailed" };

  const revoked = await withTenant(viewer.tenantId, async (tx) => {
    const [removed] = await tx
      .delete(session)
      .where(and(eq(session.id, id), eq(session.userId, viewer.userId)))
      .returning({ id: session.id });
    if (!removed) return false;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      subjectId: viewer.userId,
      action: "auth.session.revoked",
      entityType: "session",
      entityId: id,
      outcome: "success",
    });
    return true;
  });

  if (!revoked) return { ok: false, message: "saveFailed" };
  revalidatePath("/settings");
  return { ok: true, message: "sessionRevoked" };
}
