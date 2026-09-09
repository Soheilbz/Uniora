import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { tenants } from "@/db/schema.ts";
import { PAGE_SIZE, type RegisterQuery } from "@/lib/register/spec.ts";
import { readRegister } from "./register.ts";

/**
 * The register's query, against a real PostgreSQL.
 *
 * These are integration tests and they are separated from the unit suite for one
 * reason: what they check cannot be checked without a database. Text folding is a
 * PostgreSQL function, the vocabulary ordering is a correlated subquery, and
 * paging stability is a property of how the planner breaks ties. A mock would
 * assert that the code calls the functions it calls, which is not the question.
 *
 * They connect as the *owning* role rather than the application's. That is the
 * one place this file departs from how the register really runs, and it is
 * deliberate: the tenant has to be looked up before a tenant can be set, which
 * is exactly the operation row-level security forbids. What runs inside
 * `readRegister` still goes through `readOnly()` and therefore still sets the
 * tenant for its transaction — the isolation itself is proven in
 * `db/sql/after/0001`, not here.
 */

const DATABASE = process.env.DATABASE_URL;

describe.skipIf(!DATABASE)("readRegister", () => {
  let tenantId: string;

  const base: RegisterQuery = {
    search: "",
    filters: {},
    sort: "name",
    direction: "asc",
    page: 1,
    size: PAGE_SIZE,
  };

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

  it("pages, and reports a total that outlives the page", async () => {
    const first = await readRegister(tenantId, base);
    expect(first.rows.length).toBe(PAGE_SIZE);
    // The total is the whole filtered set, not the rows on screen — the
    // distinction the pager depends on.
    expect(first.total).toBeGreaterThan(PAGE_SIZE);
    expect(first.pages).toBe(Math.ceil(first.total / PAGE_SIZE));
  });

  it("never shows the same record on two pages", async () => {
    /*
     * The bug this exists to catch: ordered by a column many rows share, with no
     * tiebreaker, PostgreSQL may return page 2 in an order inconsistent with the
     * one used to decide page 1. A record can then appear twice and another
     * never appears at all — and it reproduces only at certain row counts, which
     * is why it survives casual testing.
     */
    const pages = await Promise.all(
      [1, 2, 3].map((page) => readRegister(tenantId, { ...base, sort: "degree", page })),
    );
    const ids = pages.flatMap((page) => page.rows.map((row) => row.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sorts a vocabulary column by the office's order, not the stored key", async () => {
    const ascending = await readRegister(tenantId, { ...base, sort: "degree" });
    const descending = await readRegister(tenantId, {
      ...base,
      sort: "degree",
      direction: "desc",
    });

    /*
     * `bachelor` is position 2 in the vocabulary and `phd` is position 5, but
     * alphabetically `bachelor` also precedes `phd` — so a test that only
     * checked those two would pass on a sort that ignored the vocabulary
     * entirely. `professional_doctorate` is the discriminator: position 4, but
     * alphabetically last of the four degrees the cohort uses.
     */
    expect(ascending.rows[0]?.degree).toBe("bachelor");
    expect(descending.rows[0]?.degree).toBe("phd");
  });

  it("filters, and narrows the total with the rows", async () => {
    const all = await readRegister(tenantId, base);
    const enrolled = await readRegister(tenantId, { ...base, filters: { status: "enrolled" } });

    expect(enrolled.total).toBeLessThan(all.total);
    expect(enrolled.total).toBeGreaterThan(0);
    for (const row of enrolled.rows) expect(row.status).toBe("enrolled");
  });

  it("finds a name typed on an Arabic keyboard", async () => {
    /*
     * «رضایی» with Persian yeh, and «رضايي» with Arabic yeh, are different bytes
     * and the same family name. A clerk gets whichever their keyboard produces
     * and must find the record either way.
     */
    const persian = await readRegister(tenantId, { ...base, search: "رضایی" });
    const arabic = await readRegister(tenantId, { ...base, search: "رضايي" });

    expect(persian.total).toBeGreaterThan(0);
    expect(arabic.total).toBe(persian.total);
  });

  it("finds a student number typed in Persian digits", async () => {
    const ascii = await readRegister(tenantId, { ...base, search: "40012345" });
    const persian = await readRegister(tenantId, { ...base, search: "۴۰۰۱۲۳۴۵" });

    expect(ascii.total).toBe(1);
    expect(persian.total).toBe(1);
    expect(persian.rows[0]?.id).toBe(ascii.rows[0]?.id);
  });

  it("treats a multi-word search as every word, not one string", async () => {
    // A given name and a family name are not adjacent in the folded column in
    // the order somebody types them — a needle containing the space cannot
    // match, and each word separately must.
    const found = await readRegister(tenantId, { ...base, search: "مریم رضایی" });
    expect(found.total).toBeGreaterThan(0);
    expect(found.rows[0]?.firstName).toBe("مریم");
  });

  it("returns nothing, rather than everything, for a search that matches nothing", async () => {
    const none = await readRegister(tenantId, { ...base, search: "زززز" });
    expect(none.total).toBe(0);
    expect(none.rows).toHaveLength(0);
    // Still one page: a pager that reports zero pages has nothing to render and
    // a pager that reports NaN renders "صفحه ۱ از NaN".
    expect(none.pages).toBe(1);
  });

  it("resolves supervisor names through the foreign keys", async () => {
    const first = await readRegister(tenantId, { ...base, sort: "studentNumber" });
    expect(first.rows.every((row) => row.primarySupervisor)).toBe(true);
    // Some records have a second supervisor and some do not; both shapes have to
    // come back, because the table lays out one, two and none differently.
    expect(first.rows.some((row) => row.secondarySupervisor)).toBe(true);
    expect(first.rows.some((row) => !row.secondarySupervisor)).toBe(true);
  });
});
