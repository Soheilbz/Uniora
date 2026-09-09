import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { roleCapabilities, roles, tenants, userRoles } from "@/db/schema.ts";
import { CAPABILITIES, ORDINARY_TIER, SENIOR_TIER } from "@/lib/capabilities.ts";
import { readRoles } from "./role-queries.ts";
import { readAssignableRoles, readUsers } from "./user-queries.ts";

/**
 * The tier rule, against a real database.
 *
 * This is the one thing on the settings screens whose failure is not a wrong
 * number on a page — it is somebody granting themselves the administrator role.
 * `users.manage` and `roles.manage` are only safe to hand out because nobody
 * may act on an account, or assign a role, at or above their own tier.
 *
 * Every assertion below is about what the *server* reports, not about which
 * buttons a screen draws: a disabled control is a courtesy, and the check is
 * the control.
 */
describe.skipIf(!process.env.DATABASE_URL)("the tier rule", () => {
  let tenantId: string;

  beforeAll(async () => {
    const [tenant] = await adminDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "univ"))
      .limit(1);
    if (!tenant) throw new Error("seed the database first: pnpm seed");
    tenantId = tenant.id;
    await setAdminTenantContext(tenantId);
  });

  it("offers a senior administrator no role at or above their own level", async () => {
    const offered = await readAssignableRoles(tenantId, SENIOR_TIER, false);

    /*
     * The decisive property. `administrator` sits at the tenant administrator tier, so a
     * senior must not be offered it — that is the whole escalation route:
     * assign it to yourself and every other check is moot.
     */
    const assignable = offered.filter((role) => role.assignable);
    expect(assignable.length).toBeGreaterThan(0);
    expect(assignable.every((role) => role.tier < SENIOR_TIER)).toBe(true);
    expect(offered.some((role) => !role.assignable)).toBe(true);
  });

  it("offers an ordinary account nothing to assign at all", async () => {
    const offered = await readAssignableRoles(tenantId, ORDINARY_TIER, false);
    /* Nothing is below the bottom tier, so nothing is assignable. A list that
       returned the ordinary roles here would let the lowest tier hand out its
       own privileges. */
    expect(offered.every((role) => !role.assignable)).toBe(true);
  });

  it("marks a role above the viewer as not editable, and a system role never", async () => {
    const seen = await readRoles(tenantId, SENIOR_TIER);
    expect(seen.length).toBeGreaterThan(0);

    for (const role of seen) {
      if (role.editable) {
        expect(role.isSystem).toBe(false);
        expect(role.tier).toBeLessThan(SENIOR_TIER);
      }
    }

    /* The seeded roles are the institution's own and must not be editable from
       the interface — removing `users.manage` from the administrator role would
       lock the institution out of its own account administration. */
    const system = seen.filter((role) => role.isSystem);
    expect(system.length).toBeGreaterThan(0);
    expect(system.every((role) => !role.editable)).toBe(true);
  });

  it("never reports an account as actionable by itself", async () => {
    const [administrator] = await adminDb()
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.key, "administrator"))
      .limit(1);
    if (!administrator) throw new Error("seed the database first: pnpm seed");

    /*
     * Even at the top tier, looking at your own row.
     *
     * Somebody who could suspend or revoke themselves can lock the institution
     * out of its own administration with one click and no way back through the
     * interface.
     */
    const page = await readUsers(tenantId, administrator.userId, 2, true, "");
    const self = page.rows.find((row) => row.id === administrator.userId);
    expect(self).toBeDefined();
    expect(self?.self).toBe(true);
    expect(self?.actionable).toBe(false);
  });

  it("reports an administrator as beyond a senior's reach", async () => {
    const [administrator] = await adminDb()
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.key, "administrator"))
      .limit(1);
    if (!administrator) throw new Error("seed the database first: pnpm seed");

    /* A different person, at the senior tier, looking at the administrator. */
    const page = await readUsers(tenantId, "somebody-else", SENIOR_TIER, false, "");
    const target = page.rows.find((row) => row.id === administrator.userId);
    expect(target).toBeDefined();
    expect(target?.actionable).toBe(false);
  });

  it("grants the seeded administrator every capability this build defines", async () => {
    /*
     * A capability added to the closed list and never granted is a screen
     * nobody can open — which is how `institution.manage` would have shipped
     * invisible. This is the check that says the list and the seed agree.
     */
    const held = await adminDb()
      .select({ capability: roleCapabilities.capability })
      .from(roleCapabilities)
      .innerJoin(roles, eq(roles.id, roleCapabilities.roleId))
      .where(and(eq(roles.key, "administrator"), eq(roles.tenantId, tenantId)));

    const granted = new Set(held.map((row) => row.capability));
    const missing = CAPABILITIES.filter((capability) => !granted.has(capability));
    expect(missing).toEqual([]);
  });

  it("enforces tenant role tiers in PostgreSQL", async () => {
    const result = await adminDb().execute(sql`
      select pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
      where c.conname = 'roles_tier_check'
        and c.conrelid = 'roles'::regclass
    `);
    const [row] = result.rows as Array<{ definition: string }>;
    expect(row?.definition).toContain("tier");
    expect(row?.definition).toContain(">= 0");
    expect(row?.definition).toContain("<= 2");
  });

  it("keeps the audit trail append-only for the application's own role", async () => {
    /*
     * The trail is only evidence if the code that writes it cannot rewrite it.
     * `univ_app_web` holds INSERT and SELECT and must hold neither UPDATE nor
     * DELETE — a grant, not a convention, so no future action can be written
     * that erases a row.
     */
    const granted = await adminDb().execute(sql`
      select privilege_type from information_schema.role_table_grants
      where table_name = 'audit_log' and grantee = 'univ_app_web'`);

    const held = new Set(
      (granted.rows as { privilege_type: string }[]).map((row) => row.privilege_type),
    );
    expect(held.has("INSERT")).toBe(true);
    expect(held.has("SELECT")).toBe(true);
    expect(held.has("UPDATE")).toBe(false);
    expect(held.has("DELETE")).toBe(false);
  });
});
