import { describe, expect, it } from "vitest";
import { type CapacityProfessor, type EngineOptions, explainCapacity } from "./engine.ts";
import type { CountableParsa, LedgerStudent, SupervisorSeat } from "./ledger.ts";
import {
  ABSENT_CAPACITY_INPUTS,
  baseCapacity,
  CAPACITY_INPUTS,
  CAPACITY_TABLE_BY_DEGREE,
  CAPACITY_TABLES,
  internationalCapacity,
} from "./regulation.ts";

/**
 * The regulation, applied.
 *
 * ── Why every one of these is a property and not a figure ───────────────────
 *
 * A capacity engine cannot fail loudly. It returns a number, and a wrong number
 * looks exactly like a right one on a screen an office uses to decide whether a
 * colleague may take another student. The two directions are not symmetrical
 * either: too *little* allowance blocks an appointment somebody notices and
 * complains about, and too *much* lets a group over-assign students, which is
 * the failure the regulation exists to prevent and which nobody notices until
 * the supervision is already carrying it.
 *
 * So the tests below check the shape of the rules — that a student costs one
 * place however it is divided, that an unknown always resolves against the
 * supervisor, that no figure is ever reported as settled when it is not.
 */

const HOME = "ferdowsi";

function professor(over: Partial<CapacityProfessor> = {}): CapacityProfessor {
  return {
    id: "p1",
    academicRank: "associate_professor",
    department: "clinical",
    faculty: null,
    university: HOME,
    specialization: null,
    ...over,
  };
}

function student(over: Partial<LedgerStudent> = {}): LedgerStudent {
  return {
    id: "s1",
    studentNumber: "400123456",
    firstName: "مریم",
    lastName: "رضایی",
    degree: "phd",
    status: "enrolled",
    nationality: "iranian",
    department: "clinical",
    entryMethod: null,
    primarySupervisorId: null,
    secondarySupervisorId: null,
    thirdSupervisorId: null,
    ...over,
  };
}

function parsa(seats: SupervisorSeat[], over: Partial<CountableParsa> = {}): CountableParsa {
  const one = student(over.student ?? {});
  return {
    studentId: one.id,
    student: one,
    appointment: {
      id: "a1",
      studentId: one.id,
      meetingDate: "2026-01-01",
      meetingNumber: "680",
      primarySupervisorId: null,
      secondarySupervisorId: null,
      thirdSupervisorId: null,
    },
    table: "dissertation",
    seats,
    international: false,
    ...over,
  };
}

const seat = (name: SupervisorSeat["seat"], professorId: string | null): SupervisorSeat => ({
  seat: name,
  name: `نام ${professorId ?? "بیرونی"}`,
  professorId,
});

/** Departments compared after the same folding the registers use. */
const options = (professors: CapacityProfessor[]): EngineOptions => ({
  professors,
  homeUniversity: HOME,
  fold: (value) => value.trim().toLowerCase(),
});

describe("the allowance", () => {
  it("reads row 1 of the right table for the rank", () => {
    const only = professor({ academicRank: "full_professor" });
    const out = explainCapacity([], options([only])).get("p1");

    expect(out?.dissertation.base).toBe(5);
    expect(out?.thesis.base).toBe(6);
    /* Row 6 is flat across the ranks, which is the part that is easy to get
       wrong by assuming it steps down like row 1. */
    expect(out?.dissertation.internationalAllowance).toBe(3);
    expect(out?.thesis.internationalAllowance).toBe(4);
  });

  it("has no allowance at all for a rank the tables have no column for", () => {
    /*
     * «مربی» is not in the tables. That is «no base», not «a base of zero» —
     * the first is a question for the office, the second is a statement that an
     * instructor may supervise nobody, which the regulation does not make.
     */
    const out = explainCapacity([], options([professor({ academicRank: "instructor" })])).get("p1");
    expect(out?.rank).toBeNull();
    expect(out?.dissertation.base).toBeNull();
    expect(out?.dissertation.allowance).toBeNull();
    expect(out?.dissertation.remaining).toBeNull();
    expect(out?.dissertation.ceiling).toBeNull();
  });

  it("charges the professional doctorate against the thesis table", () => {
    /*
     * The entry that matters most. Against the dissertation table it would be
     * scored on a base of 5/4/3 instead of 6/5/4 — systematically, invisibly,
     * and for the largest cohort this faculty supervises.
     */
    expect(CAPACITY_TABLE_BY_DEGREE.professional_doctorate).toBe("thesis");
    expect(CAPACITY_TABLE_BY_DEGREE.phd).toBe("dissertation");
    expect(CAPACITY_TABLE_BY_DEGREE.master).toBe("thesis");
    /* An undergraduate has no supervisor in this sense and no table. */
    expect(CAPACITY_TABLE_BY_DEGREE.bachelor).toBeUndefined();
  });

  it("puts article 13's ceiling at half the allowance", () => {
    const out = explainCapacity([], options([professor()])).get("p1");
    expect(out?.dissertation.allowance).toBe(4);
    expect(out?.dissertation.ceiling).toBe(2);
  });
});

describe("what a student costs", () => {
  it("charges a sole supervisor a whole place", () => {
    const out = explainCapacity([parsa([seat("primary", "p1")])], options([professor()])).get("p1");
    expect(out?.dissertation.used).toBe(1);
    expect(out?.dissertation.remaining).toBe(3);
  });

  it("preserves the register-only source marker in the counted explanation", () => {
    const out = explainCapacity(
      [parsa([seat("primary", "p1")], { appointmentOnly: true })],
      options([professor()]),
    ).get("p1");

    expect(out?.dissertation.counted[0]?.appointmentOnly).toBe(true);
  });

  it("splits a joint supervision so the student still costs one place", () => {
    /*
     * The property proviso 7 rests on: one student is one place however many
     * people share the work. Checked as a sum rather than as «each gets ½»,
     * because that is the invariant — a third seat divides it three ways and
     * the sum must still be one.
     */
    for (const team of [
      [seat("primary", "p1"), seat("secondary", "p2")],
      [seat("primary", "p1"), seat("secondary", "p2"), seat("third", "p3")],
    ]) {
      const staff = team.map((one) => professor({ id: one.professorId as string }));
      const out = explainCapacity([parsa(team)], options(staff));
      const total = [...out.values()].reduce((sum, one) => sum + one.dissertation.used, 0);
      expect(total, `${team.length} seats still cost one place`).toBeCloseTo(1, 10);
    }
  });

  it("charges the first supervisor in full when a seat is from outside", () => {
    /*
     * Proviso 7's second sentence. The outside colleague holds no allowance
     * here, so halving would quietly give the student away for half a place —
     * this is the direction the whole engine leans against.
     */
    const staff = [professor({ id: "p1" }), professor({ id: "p2", university: "elsewhere" })];
    const out = explainCapacity(
      [parsa([seat("primary", "p1"), seat("secondary", "p2")])],
      options(staff),
    );
    expect(out.get("p1")?.dissertation.used).toBe(1);
    expect(out.get("p2")?.dissertation.used).toBe(0);
    expect(out.get("p1")?.provisional).toBe(true);
  });

  it("treats an unrecorded institution as outside, and says so", () => {
    /* Conservative, and flagged: if the colleague is in fact on staff the first
       supervisor is being over-charged, and an over-charge somebody can see is
       one they can correct. */
    const staff = [professor({ id: "p1" }), professor({ id: "p2", university: null })];
    const out = explainCapacity(
      [parsa([seat("primary", "p1"), seat("secondary", "p2")])],
      options(staff),
    );
    expect(out.get("p1")?.dissertation.used).toBe(1);
    expect(out.get("p1")?.missingInputs.map((one) => one.id)).toContain("tier_one_institutions");
  });

  it("halves again for a student from another group, so a joint one is a quarter", () => {
    /*
     * Proviso 8 states the composition outright: «۱⁄۴ و … نیز ۱⁄۴». That is the
     * two halves *multiplied*. Added, they would come to one and the discount
     * would vanish.
     */
    const staff = [professor({ id: "p1" }), professor({ id: "p2" })];
    const out = explainCapacity(
      [
        parsa([seat("primary", "p1"), seat("secondary", "p2")], {
          student: student({ department: "pathology" }),
        }),
      ],
      options(staff),
    );
    expect(out.get("p1")?.dissertation.used).toBeCloseTo(0.25, 10);
    expect(out.get("p2")?.dissertation.used).toBeCloseTo(0.25, 10);
  });

  it("does not discount when either group is unrecorded", () => {
    /* Removing three quarters of a place on a blank column would be a guess in
       the permissive direction, on the figure that decides an appointment. */
    const out = explainCapacity(
      [parsa([seat("primary", "p1")], { student: student({ department: null }) })],
      options([professor()]),
    );
    expect(out.get("p1")?.dissertation.used).toBe(1);
    expect(out.get("p1")?.missingInputs.map((one) => one.id)).toContain("group_membership");
  });

  it("counts an international student against row 6 and not row 1", () => {
    const out = explainCapacity(
      [
        parsa([seat("primary", "p1")], {
          international: true,
          student: student({ nationality: "afghan" }),
        }),
      ],
      options([professor()]),
    ).get("p1");

    expect(out?.dissertation.used).toBe(0);
    expect(out?.dissertation.internationalUsed).toBe(1);
    expect(out?.dissertation.remaining).toBe(4);
    expect(out?.dissertation.internationalRemaining).toBe(2);
  });

  it("takes a supervisor-led admission out of the count entirely", () => {
    /* Proviso 3, the one exclusion a recorded column can decide. */
    const out = explainCapacity(
      [parsa([seat("primary", "p1")], { student: student({ entryMethod: "supervisor_funded" }) })],
      options([professor()]),
    ).get("p1");

    expect(out?.dissertation.used).toBe(0);
    expect(out?.excluded).toHaveLength(1);
    expect(out?.excluded[0]?.citation).toBe("تبصره‌ی ۳");
  });

  it("never lets a place vanish because nobody can be placed", () => {
    /*
     * ── The defect this pins ───────────────────────────────────────────────
     *
     * Proviso 7's second sentence charges the first supervisor in full when a
     * colleague is from outside, and charges the outside colleague nothing.
     * Written as «own faculty or not», that second clause swallows every seat
     * the software cannot place — and on a deployment that has not yet named
     * its own university in the institution profile, it cannot place *anybody*.
     * Every capacity figure in the product read zero, which is the permissive
     * direction the whole engine claims to lean away from, and it looks exactly
     * like a faculty with no supervisions.
     *
     * So: nothing is charged only when the holder is *known* to sit elsewhere.
     */
    const unplaceable: EngineOptions = {
      professors: [
        professor({ id: "p1", university: null }),
        professor({ id: "p2", university: null }),
      ],
      homeUniversity: "",
      fold: (value) => value.trim().toLowerCase(),
    };
    const out = explainCapacity(
      [parsa([seat("primary", "p1"), seat("secondary", "p2")])],
      unplaceable,
    );

    const total = [...out.values()].reduce((sum, one) => sum + one.dissertation.used, 0);
    expect(total, "the student still costs somebody something").toBeGreaterThan(0);
    expect(out.get("p1")?.dissertation.used).toBe(1);
    expect(out.get("p1")?.provisional).toBe(true);
  });

  it("charges nothing only to a seat known to sit at another institution", () => {
    /* The other half of the same rule: a colleague the directory places
       elsewhere holds no allowance here, so charging them would invent load. */
    const staff = [professor({ id: "p1" }), professor({ id: "p2", university: "elsewhere" })];
    const out = explainCapacity(
      [parsa([seat("primary", "p1"), seat("secondary", "p2")])],
      options(staff),
    );
    expect(out.get("p2")?.dissertation.used).toBe(0);
  });

  it("ignores a seat that resolves to nobody, without dropping the student", () => {
    /*
     * A guest supervisor from another institution is a real seat that holds no
     * allowance here. Dropping the seat would turn a jointly supervised student
     * into a solo one and *double* what the remaining supervisor is charged —
     * which is why the ledger keeps unresolved names.
     */
    const out = explainCapacity(
      [parsa([seat("primary", "p1"), seat("secondary", null)])],
      options([professor()]),
    ).get("p1");

    expect(out?.dissertation.counted).toHaveLength(1);
    expect(out?.dissertation.used).toBe(1);
  });
});

describe("what the engine admits it does not know", () => {
  it("reports every professor as provisional while the inputs are absent", () => {
    /*
     * The headline property. Nine of the fifteen inputs the regulation asks for
     * are recorded nowhere, so *no* figure this engine produces is settled —
     * and one that printed as settled would be trusted for a decision it cannot
     * support.
     */
    const out = explainCapacity([], options([professor()])).get("p1");
    expect(out?.provisional).toBe(true);
    expect(out?.missingInputs.length).toBeGreaterThan(0);
  });

  it("names the rules it could not evaluate, not just the ones it used", () => {
    const named = new Set(
      explainCapacity([], options([professor()]))
        .get("p1")
        ?.missingInputs.map((one) => one.id),
    );
    /* Rows 2–5, article 12, and three of the four exclusions. */
    for (const id of [
      "research_score_quartile",
      "supervision_evaluation_band",
      "employment_track",
      "tier_one_institutions",
      "external_funding_multiple",
      "family_support_status",
    ]) {
      expect(named, `${id} is unevaluated and must be named`).toContain(id);
    }
  });

  it("never lists the same missing input twice", () => {
    /* The screen prints this list; a duplicate reads as two different problems
       and makes the office look for a second one. */
    const staff = [professor({ id: "p1" }), professor({ id: "p2", university: "elsewhere" })];
    const out = explainCapacity(
      [
        parsa([seat("primary", "p1"), seat("secondary", "p2")]),
        parsa([seat("primary", "p1"), seat("secondary", "p2")], {
          student: student({ id: "s2" }),
        }),
      ],
      options(staff),
    ).get("p1");

    const ids = out?.missingInputs.map((one) => one.id) ?? [];
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("gives an entry to a professor supervising nobody", () => {
    /* Their allowance is the answer to «may they take another», and it does not
       depend on their having one already. */
    const out = explainCapacity([], options([professor({ id: "p9" })]));
    expect(out.has("p9")).toBe(true);
    expect(out.get("p9")?.dissertation.used).toBe(0);
  });
});

describe("the regulation as transcribed", () => {
  it("keeps the two tables' figures as published", () => {
    /*
     * The one place a figure is asserted outright, because these six numbers
     * *are* the regulation — a registrar can lay this beside the PDF. Everything
     * else above is a property; this is the transcription.
     */
    expect(CAPACITY_TABLES.dissertation.base).toEqual({
      full_professor: 5,
      associate_professor: 4,
      assistant_professor: 3,
    });
    expect(CAPACITY_TABLES.thesis.base).toEqual({
      full_professor: 6,
      associate_professor: 5,
      assistant_professor: 4,
    });
    expect(Object.values(CAPACITY_TABLES.dissertation.international)).toEqual([3, 3, 3]);
    expect(Object.values(CAPACITY_TABLES.thesis.international)).toEqual([4, 4, 4]);
  });

  it("gives every input a citation and a way to supply it", () => {
    /* The absent list is printed for the office to act on. An input with no
       `supply` sentence is a row that says «missing» and nothing else. */
    for (const input of CAPACITY_INPUTS) {
      expect(input.citation, `${input.id} cites the regulation`).not.toBe("");
      expect(input.supply, `${input.id} says how to supply it`).not.toBe("");
    }
    expect(ABSENT_CAPACITY_INPUTS.length).toBeGreaterThan(0);
  });

  it("agrees with its own lookup helpers", () => {
    expect(baseCapacity("thesis", "full_professor")).toBe(6);
    expect(internationalCapacity("dissertation", "assistant_professor")).toBe(3);
  });
});
