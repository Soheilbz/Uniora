import type { FilterDef, RegisterSpec } from "@/lib/register/spec.ts";

/**
 * The council's three registers.
 *
 * ── Why three and not one ───────────────────────────────────────────────────
 *
 * A sitting produces two kinds of business, and the sitting itself is a third
 * thing. They are separate registers because an office looks for them
 * separately: "when did the council last meet" is a different question from
 * "what did they decide about this student" and from "what policy did they pass
 * in Ordibehesht". One table with sixty mostly-null columns would answer all
 * three badly.
 *
 * The sitting is the spine. A decision, a ruling and an appointment each carry
 * `meeting_id` plus a denormalised copy of the sitting's number and date — the
 * link for navigating, the copy because a minute is a historical document and
 * because business is routinely filed before the sitting record exists.
 */

const MEETING_FILTERS = [
  /*
   * The three the register offers, in its order.
   *
   * The deputy and the room have no reference list — both are typed on the
   * record — so their choices are read from the column itself. The weekday does
   * have one here, which is a departure the other direction: the reference
   * reads it from the table too, and a vocabulary gives the same seven values
   * with the office's own wording instead of whatever was typed.
   */
  { key: "deputy", set: null, narrowedBy: null },
  { key: "location", set: null, narrowedBy: null },
  { key: "day", set: "weekdays", narrowedBy: null },
] as const satisfies readonly FilterDef[];

export const MEETINGS_REGISTER: RegisterSpec = {
  basePath: "/council-meetings",
  filters: MEETING_FILTERS,
  /*
   * `attendance` is absent, and that is the same judgement the student register
   * makes about its supervisor columns: the count is derived from a jsonb array
   * and SQL has no meaningful order for "who was there". A header that looks
   * sortable and quietly does nothing is worse than one that does not offer.
   */
  sortable: ["meetingNumber", "meetingDate", "time", "location", "deputy", "notes"],
  defaultSort: "meetingDate",
};

const DECISION_FILTERS = [
  { key: "category", set: "decision_report_categories", narrowedBy: null },
  { key: "status", set: "council_review_statuses", narrowedBy: null },
  { key: "level", set: "degrees", narrowedBy: null },
  { key: "field", set: "fields_of_study", narrowedBy: null },
  { key: "research", set: "research_types", narrowedBy: null },
] as const satisfies readonly FilterDef[];

export const DECISIONS_REGISTER: RegisterSpec = {
  basePath: "/council-decisions",
  filters: DECISION_FILTERS,
  sortable: ["meeting", "student", "category", "status", "placement"],
  defaultSort: "meeting",
  defaultDirection: "desc",
};

const RULING_FILTERS = [
  { key: "category", set: "ruling_report_categories", narrowedBy: null },
  { key: "status", set: "council_review_statuses", narrowedBy: null },
] as const satisfies readonly FilterDef[];

export const RULINGS_REGISTER: RegisterSpec = {
  /*
   * The same address as the decisions register, because it is a tab on it.
   *
   * The three tabs are three tables sharing one screen, so they share a path and
   * are told apart by `?tab=`. What they must *not* share is the rest of the
   * query: switching tabs replaces it rather than carrying it, since
   * `?field=biotechnology` means nothing to a list of rulings and page eleven of
   * one is not page eleven of another.
   */
  basePath: "/council-decisions",
  filters: RULING_FILTERS,
  sortable: ["meeting", "category", "status"],
  defaultSort: "meeting",
  defaultDirection: "desc",
};

const APPOINTMENT_FILTERS = [
  { key: "level", set: "degrees", narrowedBy: null },
  { key: "field", set: "fields_of_study", narrowedBy: null },
] as const satisfies readonly FilterDef[];

export const APPOINTMENTS_REGISTER: RegisterSpec = {
  basePath: "/council-decisions",
  filters: APPOINTMENT_FILTERS,
  sortable: ["meeting", "student", "placement"],
  defaultSort: "meeting",
  defaultDirection: "desc",
};

/** Which tab of the decisions screen is open. */
export const DECISION_TABS = ["decisions", "rulings", "appointments"] as const;
export type DecisionTab = (typeof DECISION_TABS)[number];

export function isDecisionTab(value: unknown): value is DecisionTab {
  return typeof value === "string" && (DECISION_TABS as readonly string[]).includes(value);
}

export const REGISTER_FOR_TAB: Record<DecisionTab, RegisterSpec> = {
  decisions: DECISIONS_REGISTER,
  rulings: RULINGS_REGISTER,
  appointments: APPOINTMENTS_REGISTER,
};

export const MEETING_LOOKUP_SETS: readonly string[] = ["weekdays"];
export const DECISION_LOOKUP_SETS: readonly string[] = [
  "decision_report_categories",
  "ruling_report_categories",
  "council_review_statuses",
  "degrees",
  "fields_of_study",
  "research_types",
  "weekdays",
];

export interface MeetingRow {
  id: string;
  version: number;
  meetingNumber: string;
  meetingDate: string | null;
  meetingTime: string | null;
  meetingDay: string | null;
  meetingLocation: string | null;
  researchDeputy: string | null;
  presentCount: number;
  /** Absent *and* unrepresented — a member who sent a stand-in filled the seat. */
  absentCount: number;
  participants: string[] | null;
  absentees: string[] | null;
  substitutions: Record<string, string> | null;
  notes: string | null;
  /** Decisions, rulings and appointments filed against this sitting. */
  businessCount: number;
}

export interface DecisionRow {
  id: string;
  version: number;
  meetingId: string | null;
  meetingNumber: string;
  meetingDate: string | null;
  studentId: string | null;
  studentNumber: string | null;
  studentName: string | null;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  thesisTitle: string | null;
  reportCategory: string | null;
  reviewStatus: string | null;
  /* The eleven seats, as the register draws them: three supervisors, three
     advisors, four reviewers and the graduate-studies representative. */
  primarySupervisor: string | null;
  secondarySupervisor: string | null;
  thirdSupervisor: string | null;
  firstAdvisor: string | null;
  secondAdvisor: string | null;
  thirdAdvisor: string | null;
  reviewer1: string | null;
  reviewer2: string | null;
  reviewer3: string | null;
  reviewer4Invited: string | null;
  graduateStudiesRepresentative: string | null;
}

export interface RulingRow {
  id: string;
  version: number;
  meetingId: string | null;
  meetingNumber: string;
  meetingDate: string | null;
  reportCategory: string | null;
  reviewStatus: string | null;
  decisionText: string | null;
  decisionDescription: string | null;
}

export interface AppointmentRow {
  id: string;
  version: number;
  meetingId: string | null;
  meetingNumber: string;
  meetingDate: string | null;
  studentId: string | null;
  studentNumber: string | null;
  studentName: string | null;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  primarySupervisor: string | null;
  secondarySupervisor: string | null;
  thirdSupervisor: string | null;
}

/**
 * The review states that mean the council has not finished with a dossier.
 *
 * `re_review` is in the list and `conditional` is not: a dossier sent back for
 * a second look is still on the council's table, while one approved with
 * conditions has been ruled on and is the supervisor's to act on.
 *
 * Here rather than beside either of its readers, because the dashboard's review
 * queue and the attention bell both count «what the council still owes an
 * answer on», and two spellings of that is how two screens come to report
 * different backlogs for the same registry.
 */
export const AWAITING_REVIEW = ["pending", "re_review"] as const;
