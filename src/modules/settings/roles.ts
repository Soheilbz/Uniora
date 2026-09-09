"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { roleCapabilities, roles, userRoles } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { isCapability, ROLE_TIERS, tierRank } from "@/lib/capabilities.ts";
import { hasDatabaseErrorCode } from "@/lib/db-errors.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { requireElevatedSession } from "@/lib/step-up.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { currentTenantAuthority } from "./current-authority.ts";

/**
 * Roles, and the capabilities each one carries.
 *
 * ── The tier rule, which is the whole security of this screen ───────────────
 *
 * `roles.manage` without a tier rule is a privilege-escalation route: grant it
 * once and the holder edits the administrator role, gives it to themselves, and
 * holds everything. So nobody may create or edit a role at or above their own
 * tier, and nobody may put a capability into a role that they do not hold
 * themselves. Both are checked here, on the server, on every write — the screen
 * disables the controls as a courtesy, and a disabled button is not a control.
 */

const KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_ROLE_CAPABILITIES = 100;

export async function saveRole(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("roles.manage");
  await requireElevatedSession(viewer, "/settings/roles");

  const id = String(form.get("id") ?? "");
  const key = String(form.get("key") ?? "").trim();
  const name = String(form.get("name") ?? "").trim();
  const tierName = String(form.get("tier") ?? "");
  const tier = tierRank(tierName);
  const postedCapabilities = [...new Set(form.getAll("capability").map(String).filter(Boolean))];
  const chosen = postedCapabilities.filter(isCapability);

  const submitted = { key, name, tier: String(tier) };

  if (id && !isUuid(id)) return { ok: false, message: "saveFailed", values: submitted };
  if (
    !(ROLE_TIERS as readonly string[]).includes(tierName) ||
    postedCapabilities.length > MAX_ROLE_CAPABILITIES ||
    chosen.length !== postedCapabilities.length
  ) {
    return { ok: false, message: "saveFailed", values: submitted };
  }

  const errors: Record<string, string> = {};
  if (name === "") errors.name = "required";
  if (name.length > 120) errors.name = "tooLong";
  if (id === "" && !KEY_PATTERN.test(key)) errors.key = "setKeyInvalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors, values: submitted };

  /*
   * Nobody creates a role at or above their own tier.
   *
   * Without this, somebody at `senior` could mint an administrator-level role,
   * assign it to themselves, and walk around the tier boundary in two steps.
   */
  if (tier >= viewer.tier) return { ok: false, message: "beyondYourLevel", values: submitted };

  /*
   * And nobody grants a capability they do not hold.
   *
   * The same escalation by a different door: a role manager who cannot read
   * national identity numbers must not be able to mint a role that can and then
   * wear it.
   */
  const grantable = chosen.filter((capability) => viewer.capabilities.includes(capability));
  if (grantable.length !== chosen.length) {
    return { ok: false, message: "beyondYourLevel", values: submitted };
  }

  let failure: string | null;
  try {
    failure = await withTenant(viewer.tenantId, async (tx) => {
      const current = await currentTenantAuthority(tx, viewer.tenantId, viewer.userId, [
        "roles.manage",
      ]);
      if (!current) return "beyondYourLevel";
      if (
        tier >= current.tier ||
        chosen.some((capability) => !current.capabilities.has(capability))
      ) {
        return "beyondYourLevel";
      }

      let roleId = id;

      if (id === "") {
        const clash = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.key, key), eq(roles.tenantId, viewer.tenantId)))
          .limit(1);
        if (clash.length > 0) return "duplicate";

        const [created] = await tx
          .insert(roles)
          .values({ tenantId: viewer.tenantId, key, name, tier, isSystem: false })
          .returning({ id: roles.id });
        if (!created) return "saveFailed";
        roleId = created.id;
      } else {
        const [before] = await tx
          .select({ tier: roles.tier, isSystem: roles.isSystem, name: roles.name })
          .from(roles)
          .where(and(eq(roles.id, id), eq(roles.tenantId, viewer.tenantId)))
          .limit(1);
        if (!before) return "saveFailed";
        /* The role being edited must itself be below this person, and a system
         role is nobody's to edit. Checked against what is stored, not against
         what the form said it was. */
        if (before.isSystem || before.tier >= current.tier) return "beyondYourLevel";

        await tx
          .update(roles)
          .set({ name, tier, updatedAt: sql`now()` })
          .where(and(eq(roles.id, id), eq(roles.tenantId, viewer.tenantId)));
      }

      /*
       * The capability set is replaced, not merged.
       *
       * A form that posts what is ticked is a form whose *unticked* boxes are the
       * revocations, and merging would make it impossible to withdraw one. Inside
       * the transaction, so a failure leaves the role with the permissions it had
       * rather than none.
       */
      await tx.delete(roleCapabilities).where(eq(roleCapabilities.roleId, roleId));
      if (grantable.length > 0) {
        await tx
          .insert(roleCapabilities)
          .values(grantable.map((capability) => ({ roleId, capability })));
      }

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: id === "" ? "roles.create" : "roles.update",
        entityType: "role",
        entityId: roleId,
        changes: JSON.stringify({
          name: { to: name },
          tier: { to: tier },
          capabilities: { to: grantable.length },
        }),
      });

      return null;
    });
  } catch (cause) {
    if (hasDatabaseErrorCode(cause, "23505")) {
      return { ok: false, message: "duplicate", values: submitted };
    }
    throw cause;
  }

  if (failure) return { ok: false, message: failure, values: submitted };

  /* Capabilities decide what every screen shows, so the whole tree is stale. */
  revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}

export async function deleteRole(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("roles.manage");
  await requireElevatedSession(viewer, "/settings/roles");
  const id = String(form.get("id") ?? "");
  if (id === "" || !isUuid(id)) return { ok: false, message: "saveFailed" };

  const failure = await withTenant(viewer.tenantId, async (tx) => {
    const current = await currentTenantAuthority(tx, viewer.tenantId, viewer.userId, [
      "roles.manage",
    ]);
    if (!current) return "beyondYourLevel";

    const [role] = await tx
      .select({ tier: roles.tier, isSystem: roles.isSystem, name: roles.name })
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, viewer.tenantId)))
      .limit(1);
    if (!role) return "saveFailed";
    if (role.isSystem || role.tier >= current.tier) return "beyondYourLevel";

    /*
     * A role somebody holds is not deleted.
     *
     * Deleting it would withdraw every capability from every holder at once —
     * silently, from this screen, with nothing telling the five people affected
     * why their work stopped. Take it off them first, deliberately, one at a
     * time; then the role is empty and deleting it changes nobody's access.
     */
    const [held] = await tx
      .select({ holders: sql<number>`count(*)`.mapWith(Number) })
      .from(userRoles)
      .where(and(eq(userRoles.roleId, id), eq(userRoles.tenantId, viewer.tenantId)));
    if ((held?.holders ?? 0) > 0) return "deleteBlocked";

    await tx.delete(roleCapabilities).where(eq(roleCapabilities.roleId, id));
    await tx.delete(roles).where(and(eq(roles.id, id), eq(roles.tenantId, viewer.tenantId)));

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "roles.delete",
      entityType: "role",
      entityId: id,
      changes: JSON.stringify({ name: { from: role.name, to: null } }),
    });

    return null;
  });

  if (failure) return { ok: false, message: failure };

  revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}
