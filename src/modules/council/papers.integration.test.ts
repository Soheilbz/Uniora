import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { tenants } from "@/db/schema.ts";
import { PAGE_SIZE, type RegisterQuery } from "@/lib/register/spec.ts";
import { readSittingPapers, readSittings } from "./papers.ts";
import { readMeetings } from "./queries.ts";

/**
 * The two council documents, against a real PostgreSQL.
 *
 * Same reason the registers have an integration test: these are correlated
 * subqueries, and a broken correlation is *valid* SQL. It does not raise, the
 * page renders, and the only symptom is a number that disagrees with the same
 * number on another screen.
 *
 * That is exactly what happened. Written with Drizzle's column interpolation,
 * `d.meeting_number = ${councilMeetings.meetingNumber}` rendered unqualified as
 * `d.meeting_number = "meeting_number"`, which inside a subquery over
 * `council_decisions` resolves to that table's own column — a predicate true of
 * every row. Every sitting in the picker reported the entire register: «۲۲
 * مورد» beside a register badging «۵ مورد». Nothing but real rows catches it,
 * and nothing but comparing the two screens catches it.
 */

const DATABASE = process.env.DATABASE_URL;

describe.skipIf(!DATABASE)("a sitting's papers", () => {
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

  it("offers each sitting the same count the register badges it with", async () => {
    const [picker, register] = await Promise.all([
      readSittings(tenantId),
      readMeetings(tenantId, { ...base, size: 100 }),
    ]);

    const badged = new Map(register.rows.map((row) => [row.meetingNumber, row.businessCount]));
    expect(picker.length).toBeGreaterThan(0);

    for (const sitting of picker) {
      expect(badged.has(sitting.meetingNumber), `${sitting.meetingNumber} is in the register`).toBe(
        true,
      );
      expect(sitting.items, `${sitting.meetingNumber} carries one count`).toBe(
        badged.get(sitting.meetingNumber),
      );
    }
  });

  it("does not give every sitting the same count", async () => {
    /*
     * The check above passes vacuously if both sides are broken in the same
     * way — and the broken predicate gave *every* sitting the register's whole
     * total, which is a state where "they agree" is still true. This is what
     * makes the agreement mean something: the sittings on file genuinely carry
     * different amounts of business, so identical counts are the symptom.
     */
    const picker = await readSittings(tenantId);
    const counts = new Set(picker.map((sitting) => sitting.items));
    expect(counts.size, "sittings differ in how much business they carry").toBeGreaterThan(1);
  });

  it("reads a sitting's papers, grouped as the documents print them", async () => {
    const picker = await readSittings(tenantId);
    const busiest = [...picker].sort((a, b) => b.items - a.items)[0];
    if (!busiest) throw new Error("no sittings");

    const papers = await readSittingPapers(tenantId, busiest.meetingNumber);
    expect(papers, `sitting ${busiest.meetingNumber} was read`).not.toBeNull();
    if (!papers) return;

    expect(papers.meeting.meetingNumber).toBe(busiest.meetingNumber);
    expect(papers.anything).toBe(true);

    /*
     * The sections partition the cases the documents print. A case in two of
     * them would be minuted twice, and a case in none of them is the «unfiled»
     * warning rather than a silent omission.
     */
    const { proposals, defences, unfiled } = papers.sections;
    const ids = [...proposals, ...defences, ...unfiled].map((row) => row.id);
    expect(new Set(ids).size, "no case is in two sections").toBe(ids.length);
  });

  it("finds a sitting by the number the archive spells it with", async () => {
    /*
     * Sitting numbers are Persian text — «۶۸۰» — and one of them carries a
     * parenthetical: «۶۸۱ (فوق‌العاده)». Both have to round-trip through the
     * address bar, which is why the picker encodes them.
     */
    const picker = await readSittings(tenantId);
    for (const sitting of picker) {
      const papers = await readSittingPapers(tenantId, sitting.meetingNumber);
      expect(papers, `«${sitting.meetingNumber}» resolves`).not.toBeNull();
    }
  });

  it("returns nothing for a sitting that was never held", async () => {
    /* A blank document headed «جلسه ۹۹۹» is a council instrument for a sitting
       that does not exist; the page turns this into a 404 instead. */
    expect(await readSittingPapers(tenantId, "۹۹۹")).toBeNull();
  });
});
