import type { CountableParsa, SupervisorSeatName } from "./ledger.ts";
import {
  type AcademicRank,
  type CapacityInput,
  type CapacityInputId,
  type CapacityRuleSet,
  type CapacityTable,
  capacityInputFromRules,
  DEFAULT_CAPACITY_RULESET,
  isAcademicRank,
} from "./regulation.ts";

/**
 * The capacity figure, and everything needed to justify it.
 *
 * ── Why nothing here returns a bare number ──────────────────────────────────
 *
 * A figure the office cannot check will not be trusted, and should not be: this
 * engine reads a published regulation whose inputs are, for the most part, not
 * in this database. So every figure arrives with the article it comes from, the
 * students that make it up, the weight each student was charged at and the
 * proviso that set that weight — and, the part that matters most, the list of
 * inputs the regulation asked for that nobody has supplied.
 *
 * ── `provisional` is not a decoration ───────────────────────────────────────
 *
 * A capacity that is wrong in the permissive direction lets a group over-assign
 * students, which is the failure this regulation exists to prevent. So every
 * unknown resolves towards *more* load and *less* allowance — and says so. An
 * unanswerable figure must never print as a finding.
 */

/** One multiplicative step in what a student cost a supervisor. */
export interface WeightStep {
  citation: string;
  label: string;
  factor: number;
}

/** One student, as charged to one supervisor. */
export interface CountedStudent {
  studentId: string;
  studentNumber: string;
  studentName: string;
  seat: SupervisorSeatName;
  table: CapacityTable;
  international: boolean;
  /** The product of `steps`. */
  weight: number;
  steps: WeightStep[];
  /** Set when the weight rests on an input nobody has supplied. */
  provisional: boolean;
  unknowns: CapacityInputId[];
  /** The register assignment is present, but no approved appointment was found. */
  appointmentOnly?: boolean;
}

/** A supervision the regulation takes out of the count entirely. */
export interface ExcludedStudent {
  studentId: string;
  studentNumber: string;
  studentName: string;
  citation: string;
  label: string;
}

/** One line of the allowance sum: the base, then each adjustment. */
export interface AllowanceLine {
  citation: string;
  label: string;
  value: number;
}

export interface TableExplanation {
  table: CapacityTable;
  title: string;
  citation: string;
  /** `null` when the member's rank is not one the tables have a column for. */
  base: number | null;
  /** The base, then every modifier that applied. */
  lines: AllowanceLine[];
  /** Row 1 after adjustment, or `null` when there is no base to adjust. */
  allowance: number | null;
  /** Row 6 — a separate allowance, unadjusted by rows 2–5. */
  internationalAllowance: number | null;
  counted: CountedStudent[];
  used: number;
  internationalUsed: number;
  /** Allowance less use, or `null` when there is no allowance. */
  remaining: number | null;
  internationalRemaining: number | null;
  /** Article 13: simultaneous students may not exceed half the Iranian capacity. */
  ceiling: number | null;
}

export interface CapacityExplanation {
  professorId: string;
  rank: AcademicRank | null;
  dissertation: TableExplanation;
  thesis: TableExplanation;
  excluded: ExcludedStudent[];
  /** True when any figure above rests on an input nobody has supplied. */
  provisional: boolean;
  /** The inputs that made it provisional, deduplicated. */
  missingInputs: CapacityInput[];
}

/** What the engine knows about one member of staff. */
export interface CapacityProfessor {
  id: string;
  academicRank: string | null;
  department: string | null;
  faculty: string | null;
  university: string | null;
  specialization: string | null;
}

export interface EngineOptions {
  professors: readonly CapacityProfessor[];
  /**
   * The institution this deployment belongs to.
   *
   * Proviso 7 halves a supervision only between members of *this* university's
   * faculty. The institution profile provides the university key, which
   * is exactly the assumption a product serving many of them cannot make — it
   * comes from the institution profile instead. Blank means «not configured»,
   * and then no seat counts as own faculty, which is the conservative reading:
   * first supervisors are charged in full rather than halved.
   */
  homeUniversity: string;
  /** Folds two spellings of one department into one, for proviso 8. */
  fold: (value: string) => string;
  /** Immutable published rule set selected for this calculation. */
  rules?: CapacityRuleSet;
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Where a seat's holder sits, relative to this university.
 *
 * Three answers and not two, and the difference is the whole safety of proviso
 * 7. «Somewhere else» means the seat holds no allowance here. «We cannot tell»
 * must not mean the same thing — a seat that costs nobody anything is a place
 * that has quietly vanished from every figure.
 *
 * `unknown` is the ordinary case, not the edge: a directory routinely carries
 * people with no institution recorded, and a deployment that has not yet set
 * its own university in the institution profile cannot tell for *anybody*.
 */
type Standing = "own" | "elsewhere" | "unknown";

function standingOf(professor: CapacityProfessor | undefined, home: string): Standing {
  const at = str(professor?.university);
  /* Nothing to compare against: not «elsewhere», which would charge nobody. */
  if (home === "") return "unknown";
  if (at === "") return "unknown";
  return at === home ? "own" : "elsewhere";
}

interface SeatWeight {
  steps: WeightStep[];
  weight: number;
  unknowns: CapacityInputId[];
}

/**
 * What one student costs the holder of one seat.
 *
 * Proviso 7 first, then proviso 8, **multiplied** — which is exactly how
 * proviso 8 states the composition: «ظرفیت راهنمایی استاد راهنمای اول ۱⁄۴ و
 * استاد راهنمای دوم نیز ۱⁄۴», which is two halves multiplied and not added.
 */
function seatWeight(
  parsa: CountableParsa,
  seatIndex: number,
  byId: ReadonlyMap<string, CapacityProfessor>,
  options: EngineOptions,
): SeatWeight {
  const rules = options.rules ?? DEFAULT_CAPACITY_RULESET;
  const steps: WeightStep[] = [];
  const unknowns: CapacityInputId[] = [];
  const seats = parsa.seats;
  const self = seats[seatIndex];
  const holder = self?.professorId ? byId.get(self.professorId) : undefined;
  const home = options.homeUniversity;

  /* ── Proviso 7 ──────────────────────────────────────────────────────── */
  const mine = standingOf(holder, home);

  if (seats.length > 1) {
    const others = seats
      .filter((_, index) => index !== seatIndex)
      .map((seat) => standingOf(seat.professorId ? byId.get(seat.professorId) : undefined, home));

    if (mine === "own" && others.every((standing) => standing === "own")) {
      steps.push({
        citation: rules.weights.jointSupervision.citation,
        label: rules.weights.jointSupervision.label,
        /* ½ for the two the proviso describes; an even share for the rare third
           seat, so one student stays one place however it is divided. */
        factor: 1 / seats.length,
      });
    } else {
      /*
       * Somebody on the team is from outside, or nobody can say. The proviso's
       * second sentence charges the first supervisor in full — and «the place»
       * is singular: it lands on the first seat that can hold it, and the
       * remaining seats carry none of it. Charging each seat the full factor
       * would make one jointly-supervised student cost two places in exactly
       * the shipped state (home university not yet named, every holder
       * unplaceable), which is the invariant proviso 7 exists to protect.
       *
       * The factor is 0 for a seat *known* to sit at another institution —
       * that colleague holds no allowance in this faculty, so charging them
       * would invent load — and for the seats after the first carrier. A
       * holder we cannot place is charged in full instead: treating «cannot
       * tell» as «elsewhere» would drop the place from every figure in the
       * product, which is the permissive direction this engine exists to lean
       * away from.
       */
      const carrier = seats.findIndex((seat) => {
        if (!seat.professorId) return false;
        return standingOf(byId.get(seat.professorId), home) !== "elsewhere";
      });
      steps.push({
        citation: rules.weights.externalSecondSupervisor.citation,
        label: rules.weights.externalSecondSupervisor.label,
        factor:
          mine === "elsewhere"
            ? 0
            : seatIndex === carrier
              ? rules.weights.externalSecondSupervisor.firstSupervisorFactor
              : 0,
      });
      /* Whether an outside institution is a reputable foreign university or a
         domestic tier-1 one decides between this and the plain half, and
         nothing records it. */
      unknowns.push("tier_one_institutions");
    }
  }

  /* ── Proviso 8 ──────────────────────────────────────────────────────── */
  const studentGroup = options.fold(str(parsa.student.department));
  const supervisorGroup = options.fold(str(holder?.department));

  if (studentGroup === "" || supervisorGroup === "") {
    /* Not applied. Discounting on a column one side of which is blank would
       remove three quarters of a place on a guess. */
    unknowns.push("group_membership");
  } else if (studentGroup !== supervisorGroup) {
    steps.push({
      citation: rules.weights.interdisciplinary.citation,
      label: rules.weights.interdisciplinary.label,
      factor: rules.weights.interdisciplinary.factor,
    });
    /* The proviso does not reach «اعضای هیأت‌علمی وابسته‌ی گروه», and no column
       says who they are — so this discount assumes the supervisor is not one. */
    unknowns.push("affiliated_member");
  }

  const weight = steps.reduce((product, step) => product * step.factor, 1);
  return { steps, weight, unknowns };
}

function emptyTable(
  table: CapacityTable,
  rank: AcademicRank | null,
  ruleSet: CapacityRuleSet,
): TableExplanation {
  const rules = ruleSet.tables[table];
  const base = rank ? rules.base[rank] : null;
  return {
    table,
    title: rules.title,
    citation: rules.citation,
    base,
    lines: base === null ? [] : [{ citation: rules.citation, label: rules.title, value: base }],
    /*
     * Rows 2–5 and article 12 are all unevaluated — every input they turn on is
     * absent — so the allowance is the base. That is not «no adjustment
     * applied»: it is «no adjustment could be decided», which is why the whole
     * explanation is marked provisional below and the inputs are named.
     */
    allowance: base,
    internationalAllowance: rank ? rules.international[rank] : null,
    counted: [],
    used: 0,
    internationalUsed: 0,
    remaining: null,
    internationalRemaining: null,
    ceiling: null,
  };
}

/**
 * Every member of staff's capacity, explained.
 *
 * Everyone in `options.professors` gets an entry, including those supervising
 * nobody: their allowance is the answer to «may they take another», and it does
 * not depend on their having one already.
 */
export function explainCapacity(
  countable: readonly CountableParsa[],
  options: EngineOptions,
): Map<string, CapacityExplanation> {
  const rules = options.rules ?? DEFAULT_CAPACITY_RULESET;
  const byId = new Map(options.professors.map((professor) => [professor.id, professor]));
  const out = new Map<string, CapacityExplanation>();

  const explanationFor = (professor: CapacityProfessor): CapacityExplanation => {
    const existing = out.get(professor.id);
    if (existing) return existing;
    const rank = isAcademicRank(professor.academicRank) ? professor.academicRank : null;
    const fresh: CapacityExplanation = {
      professorId: professor.id,
      rank,
      dissertation: emptyTable("dissertation", rank, rules),
      thesis: emptyTable("thesis", rank, rules),
      excluded: [],
      provisional: false,
      missingInputs: [],
    };
    out.set(professor.id, fresh);
    return fresh;
  };

  for (const professor of options.professors) explanationFor(professor);

  for (const parsa of countable) {
    const number = str(parsa.student.studentNumber);
    const name = `${str(parsa.student.firstName)} ${str(parsa.student.lastName)}`.trim();

    /*
     * ── Exclusions, provisos 1–4 ────────────────────────────────────────
     *
     * Only proviso 3 can be decided: the admission route is a recorded column.
     * The other three turn on inputs nobody supplies and are reported as
     * unevaluated further down rather than silently treated as «does not
     * apply» — silently not excluding is the permissive direction, and
     * silently excluding would be worse.
     */
    const supervisorLed = rules.exclusions.find(
      (exclusion) =>
        exclusion.id === "supervisor_led_admission" &&
        str(parsa.student.entryMethod) === "supervisor_funded",
    );

    for (const [index, seat] of parsa.seats.entries()) {
      if (!seat.professorId) continue;
      const professor = byId.get(seat.professorId);
      if (!professor) continue;
      const explanation = explanationFor(professor);

      if (supervisorLed) {
        explanation.excluded.push({
          studentId: parsa.studentId,
          studentNumber: number,
          studentName: name,
          citation: supervisorLed.citation,
          label: supervisorLed.label,
        });
        continue;
      }

      const { steps, weight, unknowns } = seatWeight(parsa, index, byId, options);
      const target = explanation[parsa.table];
      target.counted.push({
        studentId: parsa.studentId,
        studentNumber: number,
        studentName: name,
        seat: seat.seat,
        table: parsa.table,
        international: parsa.international,
        weight,
        steps,
        provisional: unknowns.length > 0,
        unknowns,
        ...(parsa.appointmentOnly ? { appointmentOnly: true } : {}),
      });
      if (parsa.international) target.internationalUsed += weight;
      else target.used += weight;

      for (const unknown of unknowns) {
        if (!explanation.missingInputs.some((input) => input.id === unknown)) {
          explanation.missingInputs.push(capacityInputFromRules(rules, unknown));
        }
      }
    }
  }

  for (const explanation of out.values()) {
    for (const table of [explanation.dissertation, explanation.thesis]) {
      if (table.allowance !== null) {
        table.remaining = table.allowance - table.used;
        table.ceiling = table.allowance * rules.concurrentCeiling.factor;
      }
      if (table.internationalAllowance !== null) {
        table.internationalRemaining = table.internationalAllowance - table.internationalUsed;
      }
    }

    /*
     * Every rule this engine could not evaluate, named.
     *
     * Rows 2–5, article 12's research-track bonus and three of the four
     * exclusions are all unevaluated, because the research score, the
     * supervision evaluation, the employment track, the tier-one list, the
     * external funding figure and family-support status are none of them
     * recorded anywhere here.
     *
     * Both of the +1 modifiers and the article 12 bonus would *raise* the
     * allowance, and the three exclusions would *lower* the load — so leaving
     * them off is the safe direction in every case. It is still an assumption,
     * and an assumption the office cannot see is one it cannot correct.
     */
    for (const input of [
      ...rules.modifiers.map((modifier) => modifier.input),
      rules.researchTrackBonus.input,
      ...rules.exclusions.map((exclusion) => exclusion.input),
    ].map((id) => capacityInputFromRules(rules, id))) {
      if (
        input.availability === "absent" &&
        !explanation.missingInputs.some((known) => known.id === input.id)
      ) {
        explanation.missingInputs.push(input);
      }
    }

    explanation.provisional = explanation.missingInputs.length > 0;
  }

  return out;
}

/** The regulation's own list of what nobody has supplied, for the screen header. */
export function absentInputs(
  rules: CapacityRuleSet = DEFAULT_CAPACITY_RULESET,
): readonly CapacityInput[] {
  return rules.inputs.filter((input) => input.availability === "absent");
}
