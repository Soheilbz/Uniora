import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import {
  students,
  tenants,
  workshopCertificates,
  workshopParticipants,
  workshops,
} from "@/db/schema.ts";
import { readDataQuality } from "@/modules/settings/data-quality.ts";
import {
  decisionReport,
  meetingReport,
  professorReport,
  studentReport,
  workshopReport,
} from "./queries.ts";

/**
 * The reports, against the registers they claim to summarise.
 *
 * ── Why this is the failure mode worth testing ──────────────────────────────
 *
 * A report cannot crash in a way anybody notices. It draws a number, and a
 * number that is wrong looks exactly like a number that is right — there is no
 * blank cell, no error, nothing to review. The specific ways these go wrong are
 * known and none of them is visible: a join that multiplies a workshop by its
 * participants, a `group by` that drops the rows with a null, a filter on
 * `deleted_at` left off one panel and on the next.
 *
 * So every assertion below ties a figure to something counted independently.
 * A test that asserted «۲۶ دانشجو» would pass forever against a query that
 * summed the wrong column.
 */
describe.skipIf(!process.env.DATABASE_URL)("the reports", () => {
  let tenantId: string;

  /** The incomplete record this suite adds, and takes away again. */
  const STUDENT_NUMBER = "reports-test-incomplete";

  beforeAll(async () => {
    const [tenant] = await adminDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "univ"))
      .limit(1);
    if (!tenant) throw new Error("seed the database first: pnpm seed");
    tenantId = tenant.id;
    await setAdminTenantContext(tenantId);

    /*
     * A record with nothing in its vocabulary columns.
     *
     * Without one, the sum-to-whole assertions below are vacuous: the seed
     * fills every field on every student, so a `group by` that quietly dropped
     * the blanks would pass. That was checked by planting exactly that defect
     * and watching the suite stay green — which is the whole reason this
     * fixture exists rather than the test trusting the seed.
     *
     * It is also the state the attention panel is *for*: an enrolled student
     * whose field nobody has recorded is a real thing an office has, and the
     * report is what tells them.
     */
    await adminDb().insert(students).values({
      tenantId,
      studentNumber: STUDENT_NUMBER,
      firstName: "پرونده",
      lastName: "ناقص آزمایشی",
      status: "enrolled",
    });
  });

  afterAll(async () => {
    await adminDb()
      .delete(students)
      .where(and(eq(students.tenantId, tenantId), eq(students.studentNumber, STUDENT_NUMBER)));
  });

  /** A count straight from a table, for the reports to be measured against. */
  async function count(table: string, where = "deleted_at is null"): Promise<number> {
    const result = await adminDb().execute(
      sql.raw(
        `select count(*)::int as total from ${table} where tenant_id = '${tenantId}' and ${where}`,
      ),
    );
    return Number((result.rows[0] as { total: number }).total);
  }

  it("counts every student exactly once across the standings", async () => {
    const report = await studentReport(tenantId);

    /*
     * The decisive property of a `group by`: the parts must sum to the whole.
     * A grouping that dropped the rows with a null standing would report a
     * smaller institution, and nothing on the panel would say so.
     */
    const summed = report.byStatus.reduce((sum, row) => sum + row.count, 0);
    expect(summed).toBe(await count("students"));

    /* The fixture is present, so the assertions above and below are about a
       register that genuinely holds a blank. */
    expect(report.byField.some((row) => row.value === "")).toBe(true);
    expect(report.total).toBe(summed);
    expect(report.enrolled).toBe(
      await count("students", "deleted_at is null and status = 'enrolled'"),
    );
  });

  it("counts only the enrolled in the panels that say they do", async () => {
    const report = await studentReport(tenantId);
    const enrolled = await count("students", "deleted_at is null and status = 'enrolled'");

    /* Degree, field and faculty are all «enrolled only» on the screen. Each
       must therefore sum to the enrolled figure, not to the whole register —
       mixing the two is how a panel comes to describe graduates. */
    for (const [name, rows] of [
      ["byDegree", report.byDegree],
      ["byField", report.byField],
      ["byFaculty", report.byFaculty],
      ["byGender", report.byGender],
      ["byAdmissionType", report.byAdmissionType],
      ["byDepartment", report.byDepartment],
      ["byFundingType", report.byFundingType],
      ["byNationality", report.byNationality],
    ] as const) {
      expect(
        rows.reduce((sum, row) => sum + row.count, 0),
        name,
      ).toBe(enrolled);
    }
  });

  it("counts every professor exactly once in each directory breakdown", async () => {
    const report = await professorReport(tenantId);
    const total = await count("professors");
    expect(report.totals.professors).toBe(total);
    for (const [name, rows] of [
      ["byStatus", report.byStatus],
      ["byRank", report.byRank],
      ["byFaculty", report.byFaculty],
      ["byDepartment", report.byDepartment],
      ["byUniversity", report.byUniversity],
    ] as const) {
      expect(
        rows.reduce((sum, row) => sum + row.count, 0),
        name,
      ).toBe(total);
    }
  });

  it("never reports a gap larger than the population it is drawn from", async () => {
    const report = await studentReport(tenantId);
    for (const [name, value] of Object.entries(report.attention)) {
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(report.enrolled);
    }
  });

  it("assigns every student to exactly one furthest verified file stage", async () => {
    const report = await studentReport(tenantId);
    expect(report.stageDistribution.reduce((sum, row) => sum + row.count, 0)).toBe(report.total);
    expect(new Set(report.stageDistribution.map((row) => row.value)).size).toBe(
      report.stageDistribution.length,
    );
    expect(report.stageDistribution.every((row) => row.count > 0)).toBe(true);
    expect(report.stageTransit.every((row) => row.averageDays >= 0 && row.sampleSize > 0)).toBe(
      true,
    );
    expect(new Set(report.stageTransit.map((row) => row.value)).size).toBe(
      report.stageTransit.length,
    );
  });

  it("exposes quality checks from the same tenant and excludes no active count", async () => {
    const issues = await readDataQuality(tenantId);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.count >= 0)).toBe(true);
    expect(issues.some((issue) => issue.key === "students_missing_academic")).toBe(true);
  });

  it("agrees with the decisions register on its totals", async () => {
    const report = await decisionReport(tenantId);

    expect(report.total).toBe(await count("council_decisions"));
    expect(report.byCategory.reduce((sum, row) => sum + row.count, 0)).toBe(report.total);
    expect(report.byStatus.reduce((sum, row) => sum + row.count, 0)).toBe(report.total);
    expect(report.byDegree.reduce((sum, row) => sum + row.count, 0)).toBe(report.total);

    expect(report.attention.pending).toBe(
      await count(
        "council_decisions",
        "deleted_at is null and review_status in ('pending', 're_review')",
      ),
    );
  });

  it("lists a sitting that resolved nothing", async () => {
    /*
     * The sittings report is drawn from the sittings register, not from the
     * decisions minuted at it. A sitting that adjourned without a resolution
     * must still appear — otherwise the office has no way to notice a sitting
     * is missing from a list of sittings.
     */
    const report = await meetingReport(tenantId, null);
    expect(report.totals.sittings).toBe(await count("council_meetings"));
    expect(report.business.length).toBeGreaterThan(0);

    /* The transacted items are decisions, rulings and appointments together, so
       they cannot be fewer than the decisions alone. */
    expect(report.totals.items).toBeGreaterThanOrEqual(await count("council_decisions"));
  });

  it("narrows every panel of a report to the year it was given", async () => {
    /*
     * The period control is on three of the six. A filter applied to one panel
     * and not its neighbour is the failure worth guarding: both would draw
     * plausible numbers and only together would they be wrong.
     */
    const whole = await meetingReport(tenantId, null);
    const year = whole.perYear.at(-1)?.year;
    expect(year).toBeDefined();
    if (year === undefined) return;

    const narrowed = await meetingReport(tenantId, year);
    expect(narrowed.totals.sittings).toBeLessThanOrEqual(whole.totals.sittings);
    expect(narrowed.totals.items).toBeLessThanOrEqual(whole.totals.items);
    expect(
      narrowed.byChair.reduce((sum, row) => sum + row.count, 0),
      "chairs sum to the sittings of that year",
    ).toBe(narrowed.totals.sittings);
    expect(narrowed.byLocation.reduce((sum, row) => sum + row.count, 0)).toBe(
      narrowed.totals.sittings,
    );
  });

  it("counts each workshop's own enrolment, not the register's", async () => {
    const report = await workshopReport(tenantId, null);

    expect(report.totals.workshops).toBe(await count("workshops"));
    expect(report.totals.registered).toBe(await count("workshop_participants"));
    expect(report.totals.attended).toBe(
      await count("workshop_participants", "deleted_at is null and attendance_status = 'attended'"),
    );
    expect(report.totals.certificates).toBe(await count("workshop_certificates"));

    /*
     * The multiplication check. Three correlated subqueries on one row is the
     * shape that silently becomes a cross product: a workshop with six
     * participants and four certificates would report twenty-four of each, and
     * the totals would still look like plausible figures.
     */
    for (const row of report.rows) {
      expect(row.attended, row.title).toBeLessThanOrEqual(row.registered);
      expect(row.certificates, row.title).toBeLessThanOrEqual(row.attended);
    }
  });

  it("sums the per-workshop rows to the totals beside them", async () => {
    /*
     * The screen prints both, one under the other. They are computed from the
     * same rows here, so this is not a second opinion — it is the guard that
     * says nobody later changed one of the two to be filtered differently.
     */
    const report = await workshopReport(tenantId, null);
    expect(report.rows.reduce((sum, row) => sum + row.registered, 0)).toBe(
      report.totals.registered,
    );
    expect(report.rows.reduce((sum, row) => sum + row.attended, 0)).toBe(report.totals.attended);
    expect(report.rows.reduce((sum, row) => sum + row.certificates, 0)).toBe(
      report.totals.certificates,
    );
  });

  it("groups by the Jalali year, not the Gregorian one", async () => {
    /*
     * The years on these charts are the office's own. A Gregorian grouping
     * would put an admission from Esfand and one from Farvardin of the same
     * academic year into different columns — and every year would be labelled
     * about 621 higher than it should be, which is the visible half of the same
     * mistake.
     */
    const student = await studentReport(tenantId);
    const decisions = await decisionReport(tenantId);

    for (const [name, years] of [
      ["admissions", student.admissions],
      ["decisions", decisions.byYear],
    ] as const) {
      expect(years.length, name).toBeGreaterThan(0);
      for (const entry of years) {
        expect(entry.year, `${name} ${entry.year}`).toBeGreaterThan(1300);
        expect(entry.year, `${name} ${entry.year}`).toBeLessThan(1500);
      }
    }
  });
});

/**
 * The workshop report's «نیاز به توجه» band, against a real PostgreSQL.
 *
 * ── Why a report of zeroes has to be disproved ──────────────────────────────
 *
 * Every one of these four counts reads zero on a consistent registry, which is
 * exactly what it should do — and exactly what a query that is silently wrong
 * also does. A band of four zeroes is the most reassuring thing on the page and
 * the easiest thing in the product to get wrong without anybody noticing: an
 * office that reads «گواهی صادرنشده: ۰» every term and is never told about the
 * eleven people waiting has been actively misled.
 *
 * So each condition is planted, counted, and removed again.
 */
describe.skipIf(!process.env.DATABASE_URL)("the workshop report's attention band", () => {
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

  /** The band as the screen reads it. */
  const gaps = async () => (await workshopReport(tenantId, null)).gaps;

  it("reads clean on the seeded registry", async () => {
    /* The baseline the three tests below move away from and back to. If this
       ever fails, one of them did not clean up and the rest are meaningless. */
    expect(await gaps()).toEqual({
      certificatesOutstanding: 0,
      certificatesUnearned: 0,
      certificatesOnCancelled: 0,
      overSubscribed: 0,
    });
  });

  it("counts somebody who attended and has no certificate", async () => {
    /*
     * Planted by taking a certificate away rather than by marking somebody
     * attended: the seed's attendees all hold one, so removing a single sheet
     * creates the debt this figure exists to name, and nothing else moves.
     */
    const [issued] = await adminDb()
      .select({ id: workshopCertificates.id })
      .from(workshopCertificates)
      .where(
        and(eq(workshopCertificates.tenantId, tenantId), isNull(workshopCertificates.deletedAt)),
      )
      .limit(1);
    expect(issued, "the seed has issued a certificate").toBeDefined();
    if (!issued) return;

    await adminDb()
      .update(workshopCertificates)
      .set({ deletedAt: sql`now()` })
      .where(eq(workshopCertificates.id, issued.id));

    try {
      const after = await gaps();
      expect(after.certificatesOutstanding).toBe(1);
      /* The other three must not move: a count that rises with any change at
         all is a count that is measuring the wrong thing. */
      expect(after.certificatesUnearned).toBe(0);
      expect(after.overSubscribed).toBe(0);
    } finally {
      await adminDb()
        .update(workshopCertificates)
        .set({ deletedAt: null })
        .where(eq(workshopCertificates.id, issued.id));
    }
  });

  it("counts a certificate held by somebody the record does not show attending", async () => {
    const [holder] = await adminDb()
      .select({ id: workshopParticipants.id, was: workshopParticipants.attendanceStatus })
      .from(workshopParticipants)
      .where(
        and(
          eq(workshopParticipants.tenantId, tenantId),
          eq(workshopParticipants.attendanceStatus, "attended"),
        ),
      )
      .limit(1);
    expect(holder, "the seed has an attendee").toBeDefined();
    if (!holder) return;

    await adminDb()
      .update(workshopParticipants)
      .set({ attendanceStatus: "registered" })
      .where(eq(workshopParticipants.id, holder.id));

    try {
      const after = await gaps();
      expect(after.certificatesUnearned).toBe(1);
    } finally {
      await adminDb()
        .update(workshopParticipants)
        .set({ attendanceStatus: holder.was })
        .where(eq(workshopParticipants.id, holder.id));
    }
  });

  it("counts a workshop with more registrations than places, and ignores an unset capacity", async () => {
    const [workshop] = await adminDb()
      .select({ id: workshops.id, was: workshops.capacity, status: workshops.status })
      .from(workshops)
      .where(and(eq(workshops.tenantId, tenantId), isNull(workshops.deletedAt)))
      .limit(1);
    expect(workshop, "the seed has a workshop").toBeDefined();
    if (!workshop) return;

    /*
     * Plant the registrations this assertion needs instead of relying on a
     * particular seed snapshot. The canonical local seed intentionally does
     * not have to populate every workshop's roster, and an integration test
     * must remain meaningful against a fresh or externally managed database.
     * The deterministic guest identifiers also make recovery after an
     * interrupted test safe: stale disposable rows are removed first.
     */
    const guestNationalIds = ["reports-test-over-capacity-1", "reports-test-over-capacity-2"];
    await adminDb()
      .delete(workshopParticipants)
      .where(
        and(
          eq(workshopParticipants.tenantId, tenantId),
          inArray(workshopParticipants.externalNationalId, guestNationalIds),
        ),
      );
    const planted = await adminDb()
      .insert(workshopParticipants)
      .values(
        guestNationalIds.map((externalNationalId, index) => ({
          tenantId,
          workshopId: workshop.id,
          externalName: `گزارش ظرفیت ${index + 1}`,
          externalNationalId,
          attendanceStatus: "registered",
          paymentStatus: "free",
        })),
      )
      .returning({ id: workshopParticipants.id });

    await adminDb().update(workshops).set({ capacity: 1 }).where(eq(workshops.id, workshop.id));
    try {
      expect((await gaps()).overSubscribed).toBe(1);

      /*
       * And zero is «not recorded», not «no places».
       *
       * Without that rule every workshop in the registry reports as
       * over-subscribed the moment one person signs up — which is the failure
       * that would make the whole band unreadable.
       */
      await adminDb().update(workshops).set({ capacity: 0 }).where(eq(workshops.id, workshop.id));
      expect((await gaps()).overSubscribed).toBe(0);
    } finally {
      await adminDb()
        .update(workshops)
        .set({ capacity: workshop.was })
        .where(eq(workshops.id, workshop.id));
      await adminDb()
        .delete(workshopParticipants)
        .where(
          and(
            eq(workshopParticipants.tenantId, tenantId),
            inArray(
              workshopParticipants.id,
              planted.map(({ id }) => id),
            ),
          ),
        );
    }
  });

  it("counts certificates left standing on a cancelled workshop", async () => {
    const [workshop] = await adminDb()
      .select({ id: workshopCertificates.workshopId })
      .from(workshopCertificates)
      .where(
        and(eq(workshopCertificates.tenantId, tenantId), isNull(workshopCertificates.deletedAt)),
      )
      .limit(1);
    expect(workshop, "the seed has a certificate on a workshop").toBeDefined();
    if (!workshop) return;

    const [was] = await adminDb()
      .select({ status: workshops.status })
      .from(workshops)
      .where(eq(workshops.id, workshop.id))
      .limit(1);

    await adminDb()
      .update(workshops)
      .set({ status: "cancelled" })
      .where(eq(workshops.id, workshop.id));
    try {
      expect((await gaps()).certificatesOnCancelled).toBeGreaterThan(0);
    } finally {
      await adminDb()
        .update(workshops)
        .set({ status: was?.status ?? "completed" })
        .where(eq(workshops.id, workshop.id));
    }
  });
});
