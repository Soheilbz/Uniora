"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client.ts";
import { account, roles, session, tenants, user, userRoles } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { auth } from "@/lib/auth.ts";
import { isAuthId } from "@/lib/auth-id.ts";
import { issuer } from "@/lib/auth-issue.ts";
import { canonicalAuthUsername } from "@/lib/auth-username.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "@/lib/password-policy.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { requireElevatedSession } from "@/lib/step-up.ts";
import {
  isValidUsernameCharacters,
  USERNAME_MAXIMUM_LENGTH,
  USERNAME_MINIMUM_LENGTH,
} from "@/lib/username-policy.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { currentUserManagerTier, mutationAuthority } from "./user-authority.ts";
import { readAssignableRoles } from "./user-queries.ts";

const ISSUED_PASSWORD_MINIMUM = PASSWORD_MINIMUM_LENGTH;
const USER_DISPLAY_NAME_MAXIMUM = 120;
const MAX_ASSIGNED_ROLES = 100;

/** Creating an account and handing over its first password. */
export async function createUser(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");

  const name = String(form.get("name") ?? "").trim();
  const username = String(form.get("username") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  const chosen = [...new Set(form.getAll("role").map(String).filter(Boolean))];
  const submitted = { name, username };

  const errors: Record<string, string> = {};
  if (name === "") errors.name = "required";
  if (name.length > USER_DISPLAY_NAME_MAXIMUM) errors.name = "tooLong";
  if (
    username.length < USERNAME_MINIMUM_LENGTH ||
    username.length > USERNAME_MAXIMUM_LENGTH ||
    !isValidUsernameCharacters(username)
  ) {
    errors.username = "usernameInvalid";
  }
  if (password.length < Math.max(ISSUED_PASSWORD_MINIMUM, viewer.tenantPasswordMinLength))
    errors.password = "passwordTooShort";
  if (password.length > PASSWORD_MAXIMUM_LENGTH) errors.password = "passwordTooLong";
  if (Object.keys(errors).length > 0) return { ok: false, errors, values: submitted };
  if (chosen.length === 0) {
    return { ok: false, message: "rolesRequired", values: submitted };
  }
  if (chosen.length > MAX_ASSIGNED_ROLES || chosen.some((id) => !isUuid(id))) {
    return { ok: false, message: "saveFailed", values: submitted };
  }

  /* No role at or above the viewer's tier, checked against the database.
     This is an early refusal for UX; the same rule is re-read inside the
     provisioning transaction before any role is attached. */
  const allowed = await readAssignableRoles(viewer.tenantId, viewer.tier, viewer.isTenantOwner);
  const grantable = new Set(allowed.filter((one) => one.assignable).map((one) => one.id));
  if (chosen.some((id) => !grantable.has(id))) {
    return { ok: false, message: "beyondYourLevel", values: submitted };
  }

  const [tenant] = await db()
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, viewer.tenantId))
    .limit(1);
  if (!tenant) return { ok: false, message: "saveFailed", values: submitted };
  const authUsername = canonicalAuthUsername(tenant.slug, username);

  let created: { id: string } | null = null;
  try {
    /*
     * Through the issuing instance, so the credential is hashed by the same
     * library that verifies it at sign-in — see `auth-issue.ts` for why that is
     * a second instance and not a call on the one the route handler exposes.
     *
     * The email is synthesised because this deployment has no mail server and
     * the column is required by the library's schema. Nothing is ever sent to
     * it, and `.invalid` is the reserved suffix that guarantees nothing can be.
     */
    const result = await issuer.api.signUpEmail({
      body: {
        name,
        email: `${authUsername}@users.invalid`,
        password,
        username: authUsername,
      },
    });
    created = result?.user ? { id: result.user.id } : null;
  } catch (cause) {
    /*
     * The library's refusal is reported as «taken» only when it is.
     *
     * The internal auth key includes the tenant namespace, so a collision here
     * means this username is already used inside this university. No account
     * existence from another university is exposed.
     */
    const said = cause instanceof Error ? cause.message : String(cause);
    if (/ALREADY_EXISTS/i.test(said) || /already.*taken/i.test(said)) {
      return { ok: false, errors: { username: "usernameTaken" }, values: submitted };
    }
    return { ok: false, message: "saveFailed", values: submitted };
  }

  if (!created) return { ok: false, message: "saveFailed", values: submitted };
  const createdId = created.id;

  try {
    /*
     * The tenant is stamped through the deliberately unscoped auth database
     * boundary before tenant-scoped provisioning begins.
     *
     * A row Better Auth just wrote has `tenant_id` null — the library does not
     * know about the application's tenant scope — so `withTenant` cannot see it
     * yet. This narrowly scoped write is allowed only for a brand-new account
     * whose tenant is still null, and can only move it into the creator's tenant.
     *
     * If anything past this point fails, the account is not left behind as an
     * invisible credential — a live password with no university, absent from
     * every directory and manageable by nobody. It is deleted on the way out,
     * guarded to only ever remove what this flow just created.
     */
    const [stamped] = await db()
      .update(user)
      .set({
        tenantId: viewer.tenantId,
        displayUsername: username,
        mustChangePassword: true,
      })
      .where(and(eq(user.id, createdId), sql`${user.tenantId} is null`))
      .returning({ id: user.id });

    if (!stamped) {
      await db().delete(user).where(eq(user.id, createdId));
      return { ok: false, message: "saveFailed", values: submitted };
    }

    const provisionFailure = await withTenant(viewer.tenantId, async (tx) => {
      /* Re-authorise at the write boundary. Another administrator may have
         changed this viewer or one of the chosen roles while Better Auth was
         issuing the credential outside this transaction. */
      const current = await currentUserManagerTier(tx, viewer.tenantId, viewer.userId);
      if (current === null) return "beyondYourLevel";

      if (chosen.length > 0) {
        const chosenRoles = await tx
          .select({ id: roles.id, tier: roles.tier })
          .from(roles)
          .where(and(eq(roles.tenantId, viewer.tenantId), inArray(roles.id, chosen)));
        if (
          chosenRoles.length !== chosen.length ||
          chosenRoles.some(
            (role) => role.tier > current.tier || (role.tier === current.tier && !current.isOwner),
          )
        ) {
          return "beyondYourLevel";
        }
      }

      /*
       * The session the sign-up opened is thrown away.
       *
       * `signUpEmail` signs the new account in and hands back a session, which is
       * right when somebody is registering themselves and wrong here: this is an
       * administrator issuing an account for a colleague across a desk. Left
       * alone it shows in the directory as «۱ دستگاه فعال» before the person has
       * ever signed in, and it is a live credential that nobody is holding.
       */
      await tx.delete(session).where(eq(session.userId, createdId));

      if (chosen.length > 0) {
        await tx
          .insert(userRoles)
          .values(
            chosen.map((roleId) => ({ userId: createdId, roleId, tenantId: viewer.tenantId })),
          );
      }
      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "users.create",
        entityType: "account",
        entityId: createdId,
        changes: JSON.stringify({ username: { to: username }, roles: { to: chosen.length } }),
      });
      return null;
    });

    if (provisionFailure) {
      await db().delete(user).where(eq(user.id, createdId));
      return { ok: false, message: provisionFailure, values: submitted };
    }
  } catch (cause) {
    /* Never leave a half-issued account behind — see above. */
    await db().delete(user).where(eq(user.id, createdId));
    throw cause;
  }

  revalidatePath("/settings/users");
  return { ok: true, message: "saved" };
}

/** Replacing the roles an account holds. */
export async function assignRoles(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");
  const targetId = String(form.get("userId") ?? "");
  const chosen = [...new Set(form.getAll("role").map(String).filter(Boolean))];

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };
  if (chosen.length === 0) return { ok: false, message: "rolesRequired" };
  if (chosen.length > MAX_ASSIGNED_ROLES || chosen.some((id) => !isUuid(id))) {
    return { ok: false, message: "saveFailed" };
  }

  let changed = false;
  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity) return "accountRevoked";

    const selectedRoles =
      chosen.length === 0
        ? []
        : await tx
            .select({ id: roles.id, tier: roles.tier })
            .from(roles)
            .where(and(eq(roles.tenantId, viewer.tenantId), inArray(roles.id, chosen)));
    if (
      selectedRoles.length !== chosen.length ||
      selectedRoles.some(
        (role) =>
          role.tier > authority.viewerTier ||
          (role.tier === authority.viewerTier && !authority.viewerIsOwner),
      )
    ) {
      return "beyondYourLevel";
    }

    const before = await tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, targetId), eq(userRoles.tenantId, viewer.tenantId)));
    const beforeIds = [...new Set(before.map((row) => row.roleId))].sort();
    const afterIds = [...chosen].sort();
    if (beforeIds.length === afterIds.length && beforeIds.every((id, i) => id === afterIds[i])) {
      return null;
    }

    /* Replaced rather than merged — the unticked boxes are the revocations. */
    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, targetId), eq(userRoles.tenantId, viewer.tenantId)));
    if (chosen.length > 0) {
      await tx
        .insert(userRoles)
        .values(chosen.map((roleId) => ({ userId: targetId, roleId, tenantId: viewer.tenantId })));
    }
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.roles.assign",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({ roles: { from: beforeIds, to: afterIds } }),
    });
    changed = true;
    return null;
  });

  if (failure) return { ok: false, message: failure };
  if (changed) revalidatePath("/settings/users");
  return { ok: true, message: "saved" };
}

/** Setting a new password on somebody else's account. */
export async function resetPassword(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("users.manage");
  await requireElevatedSession(viewer, "/settings/users");
  const targetId = String(form.get("userId") ?? "");
  const password = String(form.get("password") ?? "");

  if (!isAuthId(targetId)) return { ok: false, message: "record.missing" };
  if (password.length < Math.max(ISSUED_PASSWORD_MINIMUM, viewer.tenantPasswordMinLength)) {
    return { ok: false, errors: { password: "passwordTooShort" } };
  }
  if (password.length > PASSWORD_MAXIMUM_LENGTH) {
    return { ok: false, errors: { password: "passwordTooLong" } };
  }

  /* Hash before opening the DB transaction: scrypt is intentionally expensive
     and must not hold a pooled connection while it works. The credential's
     existence and the authorisation are checked again inside the transaction. */
  const hash = await auth.$context.then((context) => context.password.hash(password));

  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const authority = await mutationAuthority(tx, viewer.tenantId, targetId, viewer.userId);
    if (!authority.ok) {
      return authority.reason === "missing" ? "record.missing" : "outranksYou";
    }
    if (!authority.hasIdentity || !authority.credentialId) return "accountRevoked";

    const [updated] = await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(account.id, authority.credentialId))
      .returning({ id: account.id });
    if (!updated) return "accountStateChanged";

    await tx
      .update(user)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(and(eq(user.id, targetId), eq(user.tenantId, viewer.tenantId)));

    /* Every session ends: a password reset must close existing bearer access. */
    await tx.delete(session).where(eq(session.userId, targetId));

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "users.password.reset",
      entityType: "account",
      entityId: targetId,
      changes: JSON.stringify({ password: { to: "…" } }),
    });
    return null;
  });

  if (failure) return { ok: false, message: failure };
  revalidatePath("/settings/users");
  return { ok: true, message: "passwordReset" };
}
