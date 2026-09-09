import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { lookups, tenants } from "@/db/schema.ts";
import { currentEntries, formOptions, labelOf, lookupTable, optionsFor } from "./lookups.ts";

/**
 * Retiring a vocabulary entry, which has to do two opposite things at once.
 *
 * An entry the office has stopped offering must vanish from every form and stay
 * legible on the four hundred records already filed under it. Get the first
 * half wrong and a clerk keeps filing students under a degree the university no
 * longer awards; get the second half wrong and those records display the bare
 * key `specialty` where a degree should be.
 *
 * This existed as a comment claiming `optionsFor` dropped retired entries for
 * some time before it was true: the column was read and then thrown away when
 * the table was built, so nothing downstream could act on it. Nothing could
 * retire an entry until the settings screen could, which is why it went
 * unnoticed — and why the check belongs here rather than in the screen.
 */
describe.skipIf(!process.env.DATABASE_URL)("a retired vocabulary entry", () => {
  let tenantId: string;
  const set = "degrees";
  const value = "retired_for_test";

  beforeAll(async () => {
    const [tenant] = await adminDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "univ"))
      .limit(1);
    if (!tenant) throw new Error("seed the database first: pnpm seed");
    tenantId = tenant.id;
    await setAdminTenantContext(tenantId);

    await adminDb().insert(lookups).values({
      tenantId,
      set,
      value,
      label: "مقطع بازنشسته‌ی آزمایشی",
      position: 99,
      retiredAt: sql`now()`,
    });
  });

  afterAll(async () => {
    await adminDb()
      .delete(lookups)
      .where(and(eq(lookups.set, set), eq(lookups.value, value)));
  });

  it("is not offered on a form", async () => {
    const table = await lookupTable(tenantId, [set]);
    const offered = optionsFor(table, set);
    expect(offered.some((entry) => entry.value === value)).toBe(false);
    /* And the live ones still are — a filter that dropped everything would pass
       the assertion above and break every form in the application. */
    expect(offered.length).toBeGreaterThan(0);
  });

  it("is not offered on a record form either", async () => {
    /*
     * The record forms take `formOptions`, not `optionsFor` — they narrow on
     * the client, so they carry the parent by value rather than by row id.
     * Filtering one of the two and not the other is how a withdrawn degree
     * stays on the single screen that can still file a student under it, which
     * is exactly what happened: the filter went into `optionsFor` first and the
     * student form went on offering the entry.
     */
    const table = await lookupTable(tenantId, [set]);
    const offered = formOptions(table, set);
    expect(offered.some((option) => option.value === value)).toBe(false);
    expect(offered.length).toBeGreaterThan(0);
  });

  it("still renders on a record already filed under it", async () => {
    const table = await lookupTable(tenantId, [set]);
    expect(labelOf(table, set, value)).toBe("مقطع بازنشسته‌ی آزمایشی");
  });

  it("is absent from the entries a settings screen offers", async () => {
    const current = await currentEntries(tenantId, set);
    expect(current.some((entry) => entry.value === value)).toBe(false);
    expect(current.every((entry) => entry.retired === false)).toBe(true);
  });
});
