import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { students, tenants, workshopParticipants, workshops } from "@/db/schema.ts";

/**
 * One person, one place, on one workshop's register.
 *
 * The rule lives in the database and nowhere else can enforce it. The form asks
 * the question before the press — a constraint that fires is a worse experience
 * than one answered in advance — but a check the application makes is a check
 * against a copy of the register read a moment ago, and two clerks registering
 * the same student at the same time both read a roster without them.
 *
 * A duplicate is not merely untidy: seats are counted by rows, so it takes a
 * place from somebody; attendance is taken per row, so the same person is marked
 * present twice; and a certificate is issued per participant, so one person ends
 * up holding two numbered certificates for one day's workshop.
 *
 * These write to a real PostgreSQL because there is nothing else to test — the
 * whole subject is what the index does. Every row inserted here is removed
 * again, and each insert is one the *test* expects to fail, so the register is
 * left exactly as it was found.
 */
describe.skipIf(!process.env.DATABASE_URL)("workshop enrolment uniqueness", () => {
  let tenantId: string;
  let workshopId: string;
  /* Two, because the tests share one workshop: the one that proves a repeat is
     refused leaves a live registration behind, and the one that proves a
     cancellation can be re-entered needs somebody not already on the roster. */
  let studentId: string;
  let otherStudentId: string;

  /** Everything this file wrote, removed in the reverse order it appeared. */
  const written: string[] = [];

  const enrol = async (values: Partial<typeof workshopParticipants.$inferInsert>) => {
    await setAdminTenantContext(tenantId);
    const [row] = await adminDb()
      .insert(workshopParticipants)
      .values({ tenantId, workshopId, ...values })
      .returning({ id: workshopParticipants.id });
    if (row) written.push(row.id);
    return row;
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

    /*
     * Its own workshop, not one the seeder wrote.
     *
     * A seeded workshop already has a roster, and a test that registers "the
     * first student" onto "the first workshop" fails or passes according to
     * whether those two happen to be paired already — which is a property of
     * the sample data, not of the rule under test.
     */
    const [workshop] = await adminDb()
      .insert(workshops)
      .values({ tenantId, title: "کارگاه آزمایشی ثبت‌نام", status: "planned" })
      .returning({ id: workshops.id });
    const [student, other] = await adminDb()
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.tenantId, tenantId), isNull(students.deletedAt)))
      .limit(2);
    if (!workshop || !student || !other) throw new Error("seed the database first: pnpm seed");
    workshopId = workshop.id;
    studentId = student.id;
    otherStudentId = other.id;
  });

  afterAll(async () => {
    await setAdminTenantContext(tenantId);
    for (const id of written.reverse()) {
      await adminDb().delete(workshopParticipants).where(eq(workshopParticipants.id, id));
    }
    /* Hard-deleted, not retired: this workshop was never the institution's, and
       a soft delete would leave it in every report that counts tombstones. */
    if (workshopId) await adminDb().delete(workshops).where(eq(workshops.id, workshopId));
  });

  it("refuses the same student twice on one workshop", async () => {
    await enrol({ studentId });
    await expect(enrol({ studentId })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("refuses the same guest twice, matched on their national id", async () => {
    await enrol({ externalName: "مهمان یکم", externalNationalId: "0084575948" });
    await expect(
      /* A different name, the same person: the identity of an outside
         participant is their national id, not what somebody typed above it. */
      enrol({ externalName: "مهمان دیگر", externalNationalId: "0084575948" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("still admits two guests whose national ids nobody has yet", async () => {
    /*
     * The blank exemption, and it is a judgement rather than an oversight. Two
     * guests with nothing recorded are either one person twice or two people,
     * and nothing here can tell which — refusing the second would leave the
     * register unable to hold a workshop whose sign-up sheet had no id column.
     */
    await enrol({ externalName: "مهمان بی‌شناسه یکم", externalNationalId: null });
    await expect(
      enrol({ externalName: "مهمان بی‌شناسه دوم", externalNationalId: "" }),
    ).resolves.toBeDefined();
  });

  it("lets a cancelled registration be entered again", async () => {
    /*
     * Deletes are soft. An index over tombstones would reserve a person's place
     * for ever: cancelling a registration and re-entering it — which is what an
     * office does when somebody withdraws and then returns — would fail against
     * a row nobody can see or restore.
     */
    const first = await enrol({ studentId: otherStudentId });
    expect(first).toBeDefined();
    if (!first) return;

    await adminDb()
      .update(workshopParticipants)
      .set({ deletedAt: sql`now()` })
      .where(eq(workshopParticipants.id, first.id));

    await expect(enrol({ studentId: otherStudentId })).resolves.toBeDefined();
  });
});
