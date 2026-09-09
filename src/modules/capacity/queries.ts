import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { cache } from "react";
import {
  councilAppointments,
  councilDecisions,
  institutions,
  professors,
  regulationVersions,
  students,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { FINAL_DEFENSE_DECISION_CATEGORIES } from "@/lib/council-stage-policy.ts";
import { normalizePersianLetters } from "@/lib/register/validation.ts";
import { type CapacityExplanation, type CapacityProfessor, explainCapacity } from "./engine.ts";
import {
  type LedgerAppointment,
  type LedgerDecision,
  type LedgerResult,
  type LedgerStudent,
  openParsas,
  SUPERVISOR_SEATS,
} from "./ledger.ts";
import {
  type CapacityRuleSet,
  capacityTableForDegreeFromRules,
  DEFAULT_CAPACITY_RULESET,
  parseCapacityRuleSet,
} from "./regulation.ts";

/**
 * What the capacity engine reads, and the one place it is assembled.
 *
 * ── Three reads, not one join ───────────────────────────────────────────────
 *
 * The engine needs every appointing decision, every student they name and the
 * whole directory — and it needs them *whole*, because the answer for one
 * professor depends on who else sits on each of their students' teams. A join
 * would return the same student once per seat and the same professor once per
 * student, and the weighting would have to un-multiply it again. Three plain
 * reads and one pass in JavaScript is both simpler and what the engine's shape
 * already asks for.
 *
 * This is bounded work: a faculty's directory is hundreds and its open
 * supervisions are hundreds, not the whole archive. The decisions read is the
 * one that grows, and it is narrowed to the two categories that appoint or
 * discharge a team.
 */

/**
 * Folding a name to compare it with another spelling of the same name.
 *
 * The same normalisation the registers search with — the Arabic and Persian
 * yeh and kaf are different code points and the council's minutes carry both.
 * A supervisor minuted «دکتر علی رضایي» has to match the directory's «علی
 * رضایی», or their students are charged to nobody.
 *
 * The honorific is stripped for the same reason `app.fold_person` strips it in
 * SQL: minutes prefix every academic with «دکتر» and the directory does not.
 */
export function foldPerson(value: string): string {
  return normalizePersianLetters(value)
    .replace(/‌/g, " ")
    .replace(/^\s*(دکتر|پروفسور|استاد)\s+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A plainer fold, for comparing two department keys. */
export function foldKey(value: string): string {
  return normalizePersianLetters(value).replace(/\s+/g, " ").trim().toLowerCase();
}

export interface CapacityReading {
  explanations: Map<string, CapacityExplanation>;
  /** The unified supervision source for the explanations. */
  countable: import("./ledger.ts").CountableParsa[];
  ledger: LedgerResult;
  directory: CapacityProfessor[];
  /** The professor's name, for a screen that lists them. */
  names: Map<string, { name: string; code: string | null }>;
  /**
   * Whether the institution has said which university it is.
   *
   * The engine cannot decide proviso 7 without it and leans conservative, so
   * the screen has to be able to say why rather than showing figures that look
   * settled.
   */
  homeUniversity: string;
  regulation: { id: string | null; versionCode: string; title: string; rules: CapacityRuleSet };
}

/**
 * Every professor's capacity, explained, as of now.
 *
 * Recomputed on every read and stored nowhere. The question this answers is
 * «may this professor take another student *today*», and a stored figure would
 * be a second copy of the truth that nothing updates when a student defends.
 */
export const readCapacityExplanations = cache(async function readCapacityExplanations(
  tenantId: string,
): Promise<CapacityReading> {
  /*
   * ── The transaction ends before the arithmetic begins ──────────────────────
   *
   * Everything below the `readOnly` block is ordinary JavaScript over rows
   * already in memory: folding names, walking the ledger, applying the
   * regulation. None of it touches the database; it runs
   * *inside* the transaction — so a pooled connection sat `idle in transaction`
   * for the whole computation.
   *
   * That is invisible on a seed and decisive under load: `pg_stat_activity`
   * showed three of five connections idle-in-transaction while two worked, so
   * the pool was two thirds occupied by requests doing no database work at all.
   * A connection is the scarcest thing this server holds; it is released the
   * moment the last row is fetched.
   */
  const fetched = await readOnly(tenantId, async (tx) => {
    const [profile] = await tx
      .select({ university: institutions.university })
      .from(institutions)
      .limit(1);

    const directoryRows = await tx
      .select({
        id: professors.id,
        firstName: professors.firstName,
        lastName: professors.lastName,
        professorCode: professors.professorCode,
        academicRank: professors.academicRank,
        department: professors.department,
        faculty: professors.faculty,
        university: professors.university,
        specialization: professors.specialization,
      })
      .from(professors)
      .where(isNull(professors.deletedAt))
      .orderBy(asc(professors.lastName), asc(professors.firstName), asc(professors.id));

    const studentRows = await tx
      .select({
        id: students.id,
        studentNumber: students.studentNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        degree: students.degree,
        status: students.status,
        nationality: students.nationality,
        department: students.department,
        entryMethod: students.entryMethod,
        primarySupervisorId: students.primarySupervisorId,
        secondarySupervisorId: students.secondarySupervisorId,
        thirdSupervisorId: students.thirdSupervisorId,
      })
      .from(students)
      /* The student register is the second source of truth for this screen.
       * A student assigned to a professor there must not disappear merely
       * because the council has not yet issued the matching appointment. */
      .where(
        and(
          isNull(students.deletedAt),
          or(
            isNotNull(students.primarySupervisorId),
            isNotNull(students.secondarySupervisorId),
            isNotNull(students.thirdSupervisorId),
            inArray(
              students.id,
              tx.select({ id: councilAppointments.studentId }).from(councilAppointments),
            ),
          ),
        ),
      );

    const appointmentRows = await tx
      .select({
        id: councilAppointments.id,
        studentId: councilAppointments.studentId,
        meetingDate: councilAppointments.meetingDate,
        meetingNumber: councilAppointments.meetingNumber,
        primarySupervisorId: councilAppointments.primarySupervisorId,
        secondarySupervisorId: councilAppointments.secondarySupervisorId,
        thirdSupervisorId: councilAppointments.thirdSupervisorId,
      })
      .from(councilAppointments)
      .where(isNull(councilAppointments.deletedAt));

    const decisionRows = await tx
      .select({
        id: councilDecisions.id,
        studentId: councilDecisions.studentId,
        meetingDate: councilDecisions.meetingDate,
        meetingNumber: councilDecisions.meetingNumber,
        reportCategory: councilDecisions.reportCategory,
        reviewStatus: councilDecisions.reviewStatus,
      })
      .from(councilDecisions)
      .where(
        and(
          isNull(councilDecisions.deletedAt),
          inArray(councilDecisions.reportCategory, [...FINAL_DEFENSE_DECISION_CATEGORIES]),
        ),
      );

    const [regulationRow] = await tx
      .select({
        id: regulationVersions.id,
        versionCode: regulationVersions.versionCode,
        title: regulationVersions.title,
        rulesJson: regulationVersions.rulesJson,
      })
      .from(regulationVersions)
      .where(
        and(
          eq(regulationVersions.regulationCode, "supervision-capacity"),
          eq(regulationVersions.status, "published"),
          lte(regulationVersions.effectiveFrom, sql`current_date`),
          or(
            isNull(regulationVersions.effectiveTo),
            gte(regulationVersions.effectiveTo, sql`current_date`),
          ),
        ),
      )
      .orderBy(desc(regulationVersions.effectiveFrom), desc(regulationVersions.createdAt))
      .limit(1);

    return { profile, directoryRows, studentRows, appointmentRows, decisionRows, regulationRow };
  });

  const { profile, directoryRows, studentRows, appointmentRows, decisionRows, regulationRow } =
    fetched;
  const rules = regulationRow
    ? parseCapacityRuleSet(JSON.parse(regulationRow.rulesJson) as unknown)
    : DEFAULT_CAPACITY_RULESET;
  const regulation = regulationRow
    ? {
        id: regulationRow.id,
        versionCode: regulationRow.versionCode,
        title: regulationRow.title,
        rules,
      }
    : {
        id: null,
        versionCode: DEFAULT_CAPACITY_RULESET.metadata.revision,
        title: "Bootstrap supervision capacity regulation",
        rules,
      };

  const directory: CapacityProfessor[] = directoryRows.map((row) => ({
    id: row.id,
    academicRank: row.academicRank,
    department: row.department,
    faculty: row.faculty,
    university: row.university,
    specialization: row.specialization,
  }));

  const names = new Map(
    directoryRows.map((row) => [
      row.id,
      { name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(), code: row.professorCode },
    ]),
  );

  const ledger = openParsas(
    appointmentRows as LedgerAppointment[],
    decisionRows as LedgerDecision[],
    studentRows as LedgerStudent[],
    names,
    (degree) => capacityTableForDegreeFromRules(rules, degree),
  );

  /*
   * Bring the two registers together without double-counting.
   *
   * `openParsas` remains the authoritative calculation for a structured,
   * currently open council appointment. Every other student assignment that
   * appears on a professor's student tab is added as a provisional register
   * assignment. It is charged with the same conservative weight, but carries
   * `appointmentOnly` so the detail page never presents it as council-backed.
   */
  const activeAppointmentStudents = new Set(ledger.countable.map((parsa) => parsa.studentId));
  const registerSeats: Readonly<Record<(typeof SUPERVISOR_SEATS)[number], keyof LedgerStudent>> = {
    primary: "primarySupervisorId",
    secondary: "secondarySupervisorId",
    third: "thirdSupervisorId",
  };
  const registerOnly = studentRows
    .filter((student) => !activeAppointmentStudents.has(student.id))
    .flatMap((student) => {
      const table = capacityTableForDegreeFromRules(rules, student.degree);
      if (!table) return [];
      const seats = SUPERVISOR_SEATS.flatMap((seat) => {
        const professorId = student[registerSeats[seat]];
        if (!professorId) return [];
        return [{ seat, name: names.get(professorId)?.name ?? professorId, professorId }];
      });
      if (seats.length === 0) return [];
      return [
        {
          studentId: student.id,
          student,
          appointment: null,
          table,
          seats,
          international: Boolean(student.nationality && student.nationality !== "iranian"),
          appointmentOnly: true,
        },
      ];
    });

  const countable = [...ledger.countable, ...registerOnly];

  const homeUniversity = profile?.university ?? "";
  const explanations = explainCapacity(countable, {
    professors: directory,
    homeUniversity,
    fold: foldKey,
    rules,
  });

  return { explanations, countable, ledger, directory, names, homeUniversity, regulation };
});

/** One professor's working, for the screen behind their figure. */
export async function readCapacityFor(
  tenantId: string,
  professorId: string,
): Promise<{ reading: CapacityReading; explanation: CapacityExplanation | null }> {
  const reading = await readCapacityExplanations(tenantId);
  return { reading, explanation: reading.explanations.get(professorId) ?? null };
}

/**
 * Where the minutes and the student register disagree about a supervisor.
 *
 * ── Why the two are allowed to differ ───────────────────────────────────────
 *
 * The council's decision appointed the team; the register's three columns are
 * the office's working copy, corrected as people change. Neither is wrong to
 * hold what it holds — but where they disagree, the capacity figure is computed
 * from one of them and the office is usually reading the other, and that is a
 * disagreement somebody has to settle rather than a fault to fix automatically.
 *
 * So this reports, and changes nothing.
 */
export interface Mismatch {
  studentId: string;
  studentNumber: string;
  studentName: string;
  seat: string;
  /** What the sitting minuted, as text. */
  minuted: string;
  /** Who the register names in that seat, or nothing. */
  registered: string | null;
  /** Set when the minuted name resolves to somebody in the directory. */
  minutedId: string | null;
  /** Whether this row came from the student register without a council appointment. */
  source: "minutes" | "student_register";
}

/**
 * How many disagreements one screen shows at a time.
 *
 * A register that pages at 25 does not become a register that renders
 * everything because its rows came from a computation rather than a query.
 * Left unbounded this drew 1,683 rows and 5.5 MB of HTML on a decade's archive
 * — the whole of which one person then read the first screen of.
 */
export const RECONCILE_PAGE = 50;

export async function readReconciliation(
  tenantId: string,
  page = 1,
): Promise<{ rows: Mismatch[]; total: number; page: number; pages: number }> {
  const reading = await readCapacityExplanations(tenantId);
  const out: Mismatch[] = [];

  const seatColumn = ["primarySupervisorId", "secondarySupervisorId", "thirdSupervisorId"] as const;

  for (const parsa of reading.countable) {
    if (parsa.appointmentOnly) {
      for (const seat of parsa.seats) {
        out.push({
          studentId: parsa.studentId,
          studentNumber: parsa.student.studentNumber ?? "",
          studentName: `${parsa.student.firstName ?? ""} ${parsa.student.lastName ?? ""}`.trim(),
          seat: seat.seat,
          minuted: "",
          registered: seat.professorId
            ? (reading.names.get(seat.professorId)?.name ?? seat.professorId)
            : null,
          minutedId: null,
          source: "student_register",
        });
      }
      continue;
    }
    for (const seat of parsa.seats) {
      const index = seat.seat === "primary" ? 0 : seat.seat === "secondary" ? 1 : 2;
      const column = seatColumn[index];
      const registeredId = column ? (parsa.student[column] ?? null) : null;

      /* Agreement is the common case and says nothing worth a row. */
      if (registeredId !== null && registeredId === seat.professorId) continue;
      /* Neither side names anybody — nothing to reconcile. */
      if (registeredId === null && seat.professorId === null && seat.name === "") continue;

      out.push({
        studentId: parsa.studentId,
        studentNumber: parsa.student.studentNumber ?? "",
        studentName: `${parsa.student.firstName ?? ""} ${parsa.student.lastName ?? ""}`.trim(),
        seat: seat.seat,
        minuted: seat.name,
        registered: registeredId ? (reading.names.get(registeredId)?.name ?? registeredId) : null,
        minutedId: seat.professorId,
        source: "minutes",
      });
    }
  }

  /*
   * Ordered before it is cut, so page two is the next fifty and not fifty
   * arbitrary others. By student then seat: a disagreement is looked up by the
   * person it is about.
   */
  out.sort(
    (left, right) =>
      left.studentName.localeCompare(right.studentName, "fa") ||
      left.seat.localeCompare(right.seat),
  );

  const pages = Math.max(1, Math.ceil(out.length / RECONCILE_PAGE));
  const asked = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const at = Math.min(asked, pages);
  return {
    rows: out.slice((at - 1) * RECONCILE_PAGE, at * RECONCILE_PAGE),
    total: out.length,
    page: at,
    pages,
  };
}
