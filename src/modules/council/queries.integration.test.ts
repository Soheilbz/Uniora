import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { tenants } from "@/db/schema.ts";
import { PAGE_SIZE, type RegisterQuery } from "@/lib/register/spec.ts";
import { readDecisions, readMeetingBusiness, readMeetings } from "./queries.ts";

/**
 * The council's queries, against a real PostgreSQL.
 *
 * The correlated counts are the reason this file exists. They are the kind of
 * SQL that is *valid* when it is wrong: a broken correlation returns zero, the
 * page renders, and the only symptom is a council that appears never to have
 * decided anything. Nothing but running it against real rows catches that.
 */

const DATABASE = process.env.DATABASE_URL;

describe.skipIf(!DATABASE)("the council's registers", () => {
  let tenantId: string;

  const base: RegisterQuery = {
    search: "",
    filters: {},
    sort: "meetingDate",
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

  it("counts the business filed against each sitting", async () => {
    /*
     * The regression this exists for. Written with Drizzle's column
     * interpolation, the subquery rendered as `where "meeting_id" = "id"` — and
     * inside a subquery over `council_decisions`, the bare `"id"` is *that*
     * table's id, not the outer sitting's. Every sitting reported no business.
     */
    const page = await readMeetings(tenantId, base);
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.some((row) => row.businessCount > 0)).toBe(true);
  });

  it("counts each sitting's business separately, not the whole table", async () => {
    /*
     * The other half of the same bug, and the one a single-sitting fixture would
     * miss: a correlation that is dropped entirely counts every row in the
     * table, so every sitting reports the same — correct-looking — number.
     */
    const page = await readMeetings(tenantId, base);
    const counts = new Set(page.rows.map((row) => row.businessCount));
    expect(counts.size).toBeGreaterThan(1);
  });

  it("counts attendance from the stored lists", async () => {
    const page = await readMeetings(tenantId, base);
    // The query must reflect the stored arrays exactly. A fixture should not
    // need to contain a special mixture of attendance shapes to prove that.
    expect(page.rows.every((row) => row.presentCount === (row.participants?.length ?? 0))).toBe(
      true,
    );
    expect(page.rows.every((row) => row.absentCount <= (row.absentees?.length ?? 0))).toBe(true);
  });

  it("sorts a sitting number as a number, not as text", async () => {
    /*
     * `meeting_number` is text — «۶۸۱ (فوق‌العاده)» is a real sitting — so sorted
     * as text «۱۰۰» would come before «۹۹». The leading digits are extracted and
     * cast, and the sitting whose number carries a parenthetical still sorts
     * with its siblings rather than falling to one end.
     */
    const ascending = await readMeetings(tenantId, { ...base, sort: "meetingNumber" });
    const numbers = ascending.rows.map((row) =>
      Number(
        row.meetingNumber
          .replace(/[^۰-۹0-9]/g, "")
          .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))),
      ),
    );
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("finds a sitting by a word from its minute, folded", async () => {
    const persian = await readDecisions(tenantId, {
      ...base,
      sort: "meeting",
      // `decisionText` in the deterministic seed contains this word. A
      // non-negative total is true even when search is completely broken; a
      // known hit makes the assertion exercise the generated search column.
      search: "اصلاحات",
    });
    expect(persian.total, "a word stored in the minutes finds at least one case").toBeGreaterThan(
      0,
    );

    // The same fold the student register relies on: a name typed on an Arabic
    // keyboard finds a decision filed from a Persian one.
    const arabic = await readDecisions(tenantId, { ...base, sort: "meeting", search: "نظيفي" });
    const written = await readDecisions(tenantId, { ...base, sort: "meeting", search: "نظیفی" });
    expect(arabic.total).toBe(written.total);
  });

  it("shows the newest sitting first by default", async () => {
    /*
     * Ascending is right for a register of people and wrong for a register of
     * events: nobody opens the council's decisions to read what it resolved in
     * ۱۳۹۶.
     */
    const page = await readDecisions(tenantId, { ...base, sort: "meeting", direction: "desc" });
    const dates = page.rows.map((row) => row.meetingDate).filter(Boolean) as string[];
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("filters decisions by category and by outcome", async () => {
    const all = await readDecisions(tenantId, { ...base, sort: "meeting" });
    const approved = await readDecisions(tenantId, {
      ...base,
      sort: "meeting",
      filters: { status: "approved" },
    });

    expect(approved.total).toBeLessThan(all.total);
    expect(approved.total).toBeGreaterThan(0);
    for (const row of approved.rows) expect(row.reviewStatus).toBe("approved");
  });

  it("never shows the same decision on two pages", async () => {
    const pages = await Promise.all(
      [1, 2].map((page) =>
        readDecisions(tenantId, { ...base, sort: "category", page, size: PAGE_SIZE }),
      ),
    );
    const ids = pages.flatMap((page) => page.rows.map((row) => row.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads a sitting's three kinds of business", async () => {
    const page = await readMeetings(tenantId, base);
    const busiest = [...page.rows].sort((a, b) => b.businessCount - a.businessCount)[0];
    if (!busiest) throw new Error("no sittings");

    const business = await readMeetingBusiness(tenantId, busiest.id);
    const total =
      business.decisions.length + business.rulings.length + business.appointments.length;
    // The register's count and the record page's lists have to agree — they are
    // two answers to one question, and an office that finds them different stops
    // trusting both.
    expect(total).toBe(busiest.businessCount);
  });
});
