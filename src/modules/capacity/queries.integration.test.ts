import { eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { councilAppointments, institutions, professors, tenants } from "@/db/schema.ts";
import { foldPerson, readCapacityExplanations, readReconciliation } from "./queries.ts";

/**
 * The capacity engine over a real register.
 *
 * The unit tests beside this one hold the regulation's arithmetic. What they
 * cannot check is the join between the university's rules and this database's
 * columns — which is the half the file above says outright will be the one that
 * is wrong: the regulation is the university's, the columns are ours.
 *
 * So these ask whether the engine is actually *reading* anything, and whether
 * what it reads holds together.
 */
describe.skipIf(!process.env.DATABASE_URL)("the capacity engine over the register", () => {
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

  it("explains every professor in the directory, including those supervising nobody", async () => {
    const reading = await readCapacityExplanations(tenantId);
    expect(reading.directory.length).toBeGreaterThan(0);
    /* One entry each. The allowance answers «may they take another», which does
       not depend on their having one already. */
    expect(reading.explanations.size).toBe(reading.directory.length);
  });

  it("accounts for every structured appointment it reads", async () => {
    const { ledger } = await readCapacityExplanations(tenantId);
    const { stats } = ledger;
    const accounted =
      ledger.countable.length +
      stats.closedByDefence +
      stats.closedByStatus +
      stats.studentMissing +
      stats.noCapacityTable +
      stats.noSupervisorSeat;

    expect(stats.appointmentEvents).toBeGreaterThan(0);
    /* Multiple appointments for one student collapse to the latest event, so
       the number of current states cannot exceed the appointment event count. */
    expect(accounted).toBeLessThanOrEqual(stats.appointmentEvents);
    expect(ledger.countable.length).toBeGreaterThan(0);
  });

  it("charges each student's team a total of one place, or none", async () => {
    /*
     * The invariant proviso 7 rests on, checked against real teams rather than
     * fixtures: one student is one place however many people share the work.
     *
     * «Or none» covers the two honest zeroes — a supervisor-led admission the
     * regulation excludes, and a team whose every seat is from outside this
     * university and so holds no allowance here.
     */
    const reading = await readCapacityExplanations(tenantId);

    const chargedTo = new Map<string, number>();
    for (const explanation of reading.explanations.values()) {
      for (const table of [explanation.dissertation, explanation.thesis]) {
        for (const counted of table.counted) {
          chargedTo.set(
            counted.studentId,
            (chargedTo.get(counted.studentId) ?? 0) + counted.weight,
          );
        }
      }
    }

    expect(chargedTo.size).toBeGreaterThan(0);
    for (const [studentId, total] of chargedTo) {
      expect(total, `student ${studentId} costs one place in total`).toBeLessThanOrEqual(1.000001);
      expect(total, `student ${studentId} costs something`).toBeGreaterThan(0);
    }
  });

  it("never reports a figure as settled while the regulation's inputs are missing", async () => {
    /*
     * The headline safety property. Nine of the fifteen inputs are recorded
     * nowhere, so no figure here is settled — and one that printed as settled
     * would be trusted for a decision it cannot support.
     */
    const reading = await readCapacityExplanations(tenantId);
    for (const explanation of reading.explanations.values()) {
      expect(explanation.provisional, `${explanation.professorId} is provisional`).toBe(true);
      expect(explanation.missingInputs.length).toBeGreaterThan(0);
    }
  });

  it("reads the home university, and leans conservative without it", async () => {
    /*
     * Proviso 7 halves a joint supervision only between *this* university's own
     * faculty. Three things have to line up for it to fire — a team with more
     * than one seat, an institution that has said which university it is, and
     * colleagues recorded as belonging to it — and the seeded register supplies
     * none of them.
     *
     * That is the shipped state and it is the conservative one: first
     * supervisors are charged in full rather than half, and the screen names
     * the input that would settle it. But a rule that never fires is
     * indistinguishable from a rule that was never wired up, so all three are
     * planted here and the answer has to change.
     */
    const [profile] = await adminDb()
      .select({ id: institutions.id, was: institutions.university })
      .from(institutions)
      .where(eq(institutions.tenantId, tenantId))
      .limit(1);
    expect(profile, "the seed has an institution profile").toBeDefined();
    if (!profile) return;

    /** What the selected supervision costs its first supervisor. */
    const chargedToFirst = async (studentId: string) => {
      const reading = await readCapacityExplanations(tenantId);
      let weight = 0;
      for (const explanation of reading.explanations.values()) {
        for (const table of [explanation.dissertation, explanation.thesis]) {
          for (const counted of table.counted) {
            if (counted.studentId === studentId && counted.seat === "primary") {
              weight = Math.max(weight, counted.weight);
            }
          }
        }
      }
      return weight;
    };

    const before = await readCapacityExplanations(tenantId);
    const countable = before.ledger.countable.find((parsa) => parsa.seats.length === 1);
    expect(countable, "the seed has a countable supervision").toBeDefined();
    if (!countable) return;

    /* Somebody in the directory who is not already on this team. */
    const taken = new Set(countable.seats.map((seat) => seat.professorId));
    const colleague = [...before.names.entries()].find(([id]) => !taken.has(id));
    expect(colleague, "the directory has a second colleague").toBeDefined();
    if (!colleague) return;

    const staff = await adminDb()
      .select({ id: professors.id, was: professors.university })
      .from(professors)
      .where(isNull(professors.deletedAt));
    const home = "ferdowsi";

    expect(
      await chargedToFirst(countable.studentId),
      "a sole supervisor carries the whole place",
    ).toBe(1);

    try {
      if (!countable.appointment) throw new Error("expected a structured appointment");
      await adminDb()
        .update(councilAppointments)
        .set({ secondarySupervisorId: colleague[0] })
        .where(eq(councilAppointments.id, countable.appointment.id));

      /* Two seats, but nobody is «ours» yet — proviso 7's second sentence, so
         the first supervisor is still charged in full. */
      await adminDb()
        .update(institutions)
        .set({ university: "" })
        .where(eq(institutions.id, profile.id));
      expect(
        await chargedToFirst(countable.studentId),
        "still whole while the home university is unset",
      ).toBe(1);

      await adminDb()
        .update(institutions)
        .set({ university: home })
        .where(eq(institutions.id, profile.id));
      await adminDb()
        .update(professors)
        .set({ university: null })
        .where(isNull(professors.deletedAt));
      expect(
        await chargedToFirst(countable.studentId),
        "still whole while nobody is recorded at it",
      ).toBe(1);

      for (const one of staff) {
        await adminDb()
          .update(professors)
          .set({ university: home })
          .where(eq(professors.id, one.id));
      }
      expect(
        await chargedToFirst(countable.studentId),
        "with all three, the place is halved",
      ).toBeCloseTo(0.5, 10);
    } finally {
      if (countable.appointment) {
        await adminDb()
          .update(councilAppointments)
          .set({ secondarySupervisorId: countable.appointment.secondarySupervisorId })
          .where(eq(councilAppointments.id, countable.appointment.id));
      }
      await adminDb()
        .update(institutions)
        .set({ university: profile.was })
        .where(eq(institutions.id, profile.id));
      for (const one of staff) {
        await adminDb()
          .update(professors)
          .set({ university: one.was })
          .where(eq(professors.id, one.id));
      }
    }
  });

  it("folds a minuted name onto the directory's spelling of it", async () => {
    /* The join the whole engine rests on: a supervisor the council minuted with
       the honorific has to resolve to their directory record, or their students
       are charged to nobody. */
    expect(foldPerson("دکتر علی رضایی")).toBe(foldPerson("علی رضایی"));
    expect(foldPerson("  علی   رضایی ")).toBe(foldPerson("علی رضایی"));
    expect(foldPerson("علی رضایی")).not.toBe(foldPerson("علی محمدی"));

    /* And it resolves in practice: a real register whose minuted seats matched
       nobody would compute every figure as zero and look plausible. */
    const reading = await readCapacityExplanations(tenantId);
    const resolved = reading.ledger.countable.flatMap((parsa) =>
      parsa.seats.filter((seat) => seat.professorId !== null),
    );
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("reports a disagreement between the minutes and the register without changing either", async () => {
    /* Reconciliation is a report. Both sides are allowed to hold what they
       hold; which is right is not something this can know. */
    const found = await readReconciliation(tenantId);
    /* Paged like a register — the page is what the reader is looking at. */
    expect(found.rows.length).toBeLessThanOrEqual(found.total);
    for (const one of found.rows) {
      expect(one.studentId).not.toBe("");
      expect(one.seat).not.toBe("");
      /* A row with neither side naming anybody is not a disagreement. */
      expect(one.minuted !== "" || one.registered !== null).toBe(true);
    }
  });
});
