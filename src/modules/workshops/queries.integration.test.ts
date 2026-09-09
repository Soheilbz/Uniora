import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { tenants, workshopParticipants } from "@/db/schema.ts";
import { readQuery } from "@/lib/register/params.ts";
import { WORKSHOPS_REGISTER } from "./model.ts";
import { readWorkshopLists, readWorkshops } from "./queries.ts";

/**
 * The workshop register's three per-row counts, against a real PostgreSQL.
 *
 * Each is a correlated subquery, and each fails the same silent way: a bare
 * column inside the subquery binds to the *subquery's* table, so the correlation
 * disappears and the count becomes "every participant in the institution" or
 * zero. Both are plausible numbers on a page, which is why they are checked
 * against what the tables actually hold rather than against a figure typed here.
 */
describe.skipIf(!process.env.DATABASE_URL)("readWorkshops", () => {
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

  const everything = () => readQuery(WORKSHOPS_REGISTER, { size: "100" });

  it("counts each workshop's own enrolment, not the register's", async () => {
    const page = await readWorkshops(tenantId, everything());
    expect(page.rows.length).toBeGreaterThan(1);

    /*
     * The decisive property: a lost correlation gives *every* row the same
     * total. Two workshops with different enrolment prove the subquery is still
     * tied to the outer row.
     */
    const counts = new Set(page.rows.map((row) => row.registered));
    expect(counts.size).toBeGreaterThan(1);

    const [everyone] = await adminDb()
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(workshopParticipants);
    expect(Math.max(...page.rows.map((row) => row.registered))).toBeLessThan(
      (everyone?.total ?? 0) + 1,
    );
  });

  it("agrees with the record page it links to", async () => {
    /*
     * The register and the record read the same numbers by different routes —
     * three subqueries there, three joined lists here. They are allowed to be
     * wrong only together, never apart.
     */
    const page = await readWorkshops(tenantId, everything());
    const held = page.rows.find((row) => row.registered > 0);
    expect(held).toBeDefined();
    if (!held) return;

    const lists = await readWorkshopLists(tenantId, held.id);
    expect(lists.participants.length).toBe(held.registered);
    expect(lists.participants.filter((one) => one.attendanceStatus === "attended").length).toBe(
      held.attended,
    );
    expect(lists.participants.filter((one) => one.certificateId !== null).length).toBe(
      held.certificates,
    );
  });

  it("never reports more attended than registered", async () => {
    const page = await readWorkshops(tenantId, everything());
    for (const row of page.rows) {
      expect(row.attended).toBeLessThanOrEqual(row.registered);
      expect(row.certificates).toBeLessThanOrEqual(row.attended);
    }
  });

  it("resolves an outsider by the name they registered under", async () => {
    /*
     * A participant is a student *or* somebody from another institution. The
     * `coalesce` over the student register is what keeps the outsider from
     * appearing as a blank row — which is how they would look if the join were
     * inner rather than left.
     */
    const page = await readWorkshops(tenantId, everything());
    const everyone = (
      await Promise.all(page.rows.map((row) => readWorkshopLists(tenantId, row.id)))
    ).flatMap((lists) => lists.participants);
    expect(everyone.length).toBeGreaterThan(0);

    /* Nobody is nameless — a student resolves through the directory, an
       outsider through the name they gave. */
    for (const participant of everyone) {
      expect(participant.name?.trim()).toBeTruthy();
    }
    expect(everyone.some((one) => one.studentId === null)).toBe(true);
    expect(everyone.some((one) => one.studentId !== null)).toBe(true);
  });

  it("narrows to one status without disturbing the counts", async () => {
    const all = await readWorkshops(tenantId, everything());
    const held = await readWorkshops(
      tenantId,
      readQuery(WORKSHOPS_REGISTER, { size: "100", status: "held" }),
    );

    expect(held.total).toBeLessThan(all.total);
    expect(held.rows.every((row) => row.status === "held")).toBe(true);

    /* A filter narrows which rows are listed; it must not change a row's own
       enrolment. */
    for (const row of held.rows) {
      const same = all.rows.find((candidate) => candidate.id === row.id);
      expect(same?.registered).toBe(row.registered);
    }
  });
});
