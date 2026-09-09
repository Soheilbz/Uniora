import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { councilDecisions, tenants } from "@/db/schema.ts";
import { readReviewerCounts, reviewerCases } from "./reviewers.ts";

/**
 * The examining tally, against a real PostgreSQL.
 *
 * Every rule below removes something from the count, and a rule that fails to
 * apply still produces a plausible number — a workload twice its true size looks
 * exactly like a busy year. So each is checked against a property of the result
 * rather than against a figure typed here.
 */
describe.skipIf(!process.env.DATABASE_URL)("readReviewerCounts", () => {
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

  it("counts the examiners the council actually appointed", async () => {
    const rows = await readReviewerCounts(tenantId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.reviews > 0)).toBe(true);
  });

  it("resolves a minuted name to the directory where it matches", async () => {
    /*
     * The fixture's examiners are seeded professors, so at least one row must
     * carry a `professorId`. A tally that resolved nobody would report the whole
     * faculty as external examiners.
     */
    const rows = await readReviewerCounts(tenantId);
    expect(rows.some((row) => row.professorId !== null)).toBe(true);
  });

  it("reports a guest examiner under the name the council minuted", async () => {
    /*
     * «دکتر مهدی رستمی (دانشگاه تهران)» is on the seeded decisions and is in no
     * directory — which is exactly why the board columns are text. A tally that
     * dropped unmatched names would silently under-report the panel.
     */
    const rows = await readReviewerCounts(tenantId);
    const guest = rows.find((row) => row.name.includes("رستمی"));
    expect(guest).toBeDefined();
    expect(guest?.professorId).toBeNull();
    expect(guest?.reviews).toBeGreaterThan(0);
  });

  it("keeps the representative's attendance out of the examining count", async () => {
    /*
     * The graduate-studies representative witnesses procedure, they do not mark
     * the work. Folded into `reviews` they would inflate one person's workload
     * by every case the council heard.
     */
    const rows = await readReviewerCounts(tenantId);
    const representative = rows.find((row) => row.representations > 0);
    expect(representative).toBeDefined();
    expect(representative?.reviews).toBe(0);
  });

  it("never counts a case twice for one examiner", async () => {
    /*
     * The key is (student, sitting, stage). Without it, a name appearing in two
     * seats of one decision — which happens — would count twice, and so would a
     * proposal that returned to a later sitting at the same stage.
     */
    const rows = await readReviewerCounts(tenantId);
    // The upper bound: every appointed proposal-stage decision there is. Nobody
    // can have examined more cases than there are cases.
    const [bound] = await adminDb()
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(councilDecisions)
      .where(
        and(
          isNull(councilDecisions.deletedAt),
          inArray(councilDecisions.reportCategory, ["thesis_proposal", "dissertation_proposal"]),
          inArray(councilDecisions.reviewStatus, ["approved", "conditional"]),
        ),
      );

    for (const row of rows) {
      expect(row.reviews).toBeLessThanOrEqual(bound?.total ?? 0);
      expect(row.representations).toBeLessThanOrEqual(bound?.total ?? 0);
    }
  });

  it("counts no examiner from a stage the office does not count", async () => {
    /*
     * Only proposal-stage panels. A final defence is largely the same people
     * re-reading the same thesis; counting both doubles every workload, and the
     * seeded decisions span proposal and final-defence stages so the filter has something to drop.
     */
    const rows = await readReviewerCounts(tenantId);
    const totalReviews = rows.reduce((sum, row) => sum + row.reviews, 0);
    expect(totalReviews).toBeGreaterThan(0);

    const [everything] = await adminDb()
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(councilDecisions)
      .where(isNull(councilDecisions.deletedAt));

    // Four examining seats per decision, so an unfiltered tally would exceed the
    // decision count many times over. It does not.
    expect(totalReviews).toBeLessThan((everything?.total ?? 0) * 4);
  });

  it("breaks the examining total down into degrees that add up to it", async () => {
    /*
     * The claim the register's column bands make on screen.
     *
     * «تعداد داوری» is drawn as the headline and the three degree columns are
     * banded as its parts, so a reader is told those three add up to it. If
     * they do not, the band is a lie about the table — and the way that happens
     * is quiet: a degree the vocabulary gains, or a case filed with none, falls
     * into the headline and into none of the parts.
     *
     * The fourth term is everything the three do not cover: a case with no
     * degree recorded, or one at a degree this office examines no thesis for.
     * It is not a column — the reference prints three and so does this — but it
     * has to be in the sum, because leaving it out is what turns a shortfall
     * into a silent one. On this registry it is non-zero, and the row it
     * belongs to is exactly the row this assertion first caught.
     *
     * Asserted per row rather than in total, because a shortfall on one
     * examiner and a surplus on another would cancel.
     */
    const rows = await readReviewerCounts(tenantId);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const parts = row.masters + row.generalDoctorate + row.specializedDoctorate + row.otherDegree;
      expect(parts, `${row.name}: every examination falls into exactly one degree`).toBe(
        row.reviews,
      );
    }
  });

  it("counts a student once however many stages of their work it examined", async () => {
    /*
     * The other half of the banding: «پرونده‌ها» sits outside the sum because a
     * case examined at proposal and again at defence is two examinations and
     * one case. So it may never exceed the examination count, and on a registry
     * where anybody has examined the same student twice it is strictly less.
     */
    const rows = await readReviewerCounts(tenantId);
    for (const row of rows) {
      expect(row.cases, `${row.name}: cases never exceed examinations`).toBeLessThanOrEqual(
        row.reviews,
      );
    }
  });

  it("lists exactly the cases the figure counted, for every examiner", async () => {
    /*
     * ── The property this whole screen rests on ────────────────────────────
     *
     * The register states a number and the working lists the cases behind it.
     * If the two disagree the office does not conclude that the *list* is
     * wrong — they conclude the figure is, and stop trusting the report that
     * distributes examining load across a faculty.
     *
     * They are two statements written in two places, so they can drift: a seat
     * added to one and not the other, or a matching rule that folds names in
     * the tally and compares them verbatim in the list. That second one is a
     * real defect the application shipped, and it halved the list
     * under an unchanged figure — the failure that looks most like the office
     * being wrong.
     *
     * Checked per examiner, in both directions. Examinations and
     * representations are separate figures on the row and the list carries
     * both, flagged, so the length is their sum.
     */
    const rows = await readReviewerCounts(tenantId);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const cases = await reviewerCases(tenantId, row.name);
      const representations = cases.filter((one) => one.isRepresentative).length;

      expect(cases.length, `${row.name}: the working lists what the row totals`).toBe(
        row.reviews + row.representations,
      );
      expect(representations, `${row.name}: the representative's seats are the ones flagged`).toBe(
        row.representations,
      );
    }
  });

  it("finds an examiner minuted under a second spelling of their name", async () => {
    /*
     * The fold, from the outside. An examiner the minutes name with the
     * doctoral honorific and the directory names without it is one person to
     * the tally, so asking for either spelling must return the same cases —
     * this is the comparison that was verbatim in the application.
     */
    const rows = await readReviewerCounts(tenantId);
    /* Somebody the council minuted *with* the honorific — that is the spelling
       the fold has to see through, and asking under the bare name is how the
       directory would ask. */
    const someone = rows.find((row) => row.reviews > 0 && row.name.startsWith("دکتر "));
    expect(someone, "the fixture minutes somebody with the honorific").toBeDefined();
    if (!someone) return;

    const minuted = await reviewerCases(tenantId, someone.name);
    const bare = await reviewerCases(tenantId, someone.name.replace(/^دکتر\s+/, ""));
    expect(minuted.length, "the minuted spelling finds the cases").toBeGreaterThan(0);
    expect(bare.map((one) => one.id)).toEqual(minuted.map((one) => one.id));
  });

  it("returns nothing rather than everything for a blank examiner", async () => {
    /* A missing query parameter must not open the whole register under
       somebody's name. */
    expect(await reviewerCases(tenantId, "")).toEqual([]);
    expect(await reviewerCases(tenantId, "   ")).toEqual([]);
  });
});
