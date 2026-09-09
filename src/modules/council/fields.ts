import type { FieldSpec } from "@/lib/register/field-spec.ts";

/**
 * The council's records, described once.
 *
 * The same field-spec shape the student register uses, for the same reason: the
 * detail page, the form and the validator all read one list, so a column added
 * to the schema cannot end up on the form and not in the validator.
 *
 * Pure — no drizzle, no schema. The form is a client component.
 */

export type CouncilGroup =
  | "sitting"
  | "seats"
  | "attendance"
  | "record"
  | "meeting"
  | "student"
  | "thesis"
  | "panel"
  | "officers"
  | "defense"
  | "proposalDocs"
  | "defenseDocs"
  | "text";

export type CouncilField = FieldSpec<CouncilGroup>;

const text = (
  key: string,
  group: CouncilGroup,
  maxLength: number,
  extra: Partial<CouncilField> = {},
): CouncilField => ({ key, kind: "text", group, maxLength, ...extra });

const lookup = (
  key: string,
  group: CouncilGroup,
  set: string,
  extra: Partial<CouncilField> = {},
): CouncilField => ({ key, kind: "lookup", group, set, ...extra });

const date = (key: string, group: CouncilGroup): CouncilField => ({ key, kind: "date", group });

/** A checklist item: is the paper in the file. */
const paper = (key: string, group: CouncilGroup): CouncilField => ({
  key,
  kind: "boolean",
  group,
});

/* ── The sitting ──────────────────────────────────────────────────────────── */

export const MEETING_GROUPS: readonly CouncilGroup[] = ["sitting", "attendance", "record"];

export const MEETING_FIELDS: readonly CouncilField[] = [
  text("meetingNumber", "sitting", 50, { required: true, format: "sittingNumber" }),
  date("meetingDate", "sitting"),
  /*
   * The hour as text, not a `time` control. The archive holds sittings minuted
   * as «۱۰ صبح» and «۱۰:۳۰ الی ۱۲», and a time picker cannot enter either
   * without inventing precision the minute did not have.
   */
  text("meetingTime", "sitting", 50, { format: "clockText" }),
  lookup("meetingDay", "sitting", "weekdays"),
  text("meetingLocation", "sitting", 200),
  text("researchDeputy", "sitting", 200),

  /*
   * Attendance is edited by its own control, not by a field kind.
   *
   * `participants` and `absentees` are ordered lists of names — the order is
   * what the minute prints — and `substitutions` is a name→name map. No text
   * box or select can edit either, so they are declared here for the *record*
   * page and the save, and the form renders `AttendanceEditor` in their place.
   */
  { key: "participants", kind: "text", group: "attendance" },
  { key: "absentees", kind: "text", group: "attendance" },

  text("notes", "record", 4000),
];

/* ── A student's dossier ──────────────────────────────────────────────────── */

export const DECISION_GROUPS: readonly CouncilGroup[] = [
  "meeting",
  "student",
  "thesis",
  "panel",
  "officers",
  "defense",
  "proposalDocs",
  "defenseDocs",
  "text",
];

/**
 * The six seats that direct and advise the work, in the order forms print them.
 */
export const SUPERVISION_SEATS = [
  "primarySupervisor",
  "secondarySupervisor",
  "thirdSupervisor",
  "firstAdvisor",
  "secondAdvisor",
  "thirdAdvisor",
] as const;

/** The examining board, plus the graduate-studies representative who sits with it. */
export const BOARD_SEATS = [
  "reviewer1",
  "reviewer2",
  "reviewer3",
  "reviewer4Invited",
  "graduateStudiesRepresentative",
] as const;

export const DECISION_FIELDS: readonly CouncilField[] = [
  /* ── The sitting this was decided at ─────────────────────────────── */
  text("meetingNumber", "meeting", 50, { required: true, format: "sittingNumber" }),
  date("meetingDate", "meeting"),
  text("meetingTime", "meeting", 50, { format: "clockText" }),
  lookup("meetingDay", "meeting", "weekdays"),
  text("meetingLocation", "meeting", 200),
  lookup("reportCategory", "meeting", "decision_report_categories", { required: true }),
  lookup("reviewStatus", "meeting", "council_review_statuses"),
  text("councilNotes", "meeting", 2000),

  /* ── The student ─────────────────────────────────────────────────── */
  text("studentNumber", "student", 20, { format: "digits" }),
  text("studentName", "student", 300),
  lookup("educationLevel", "student", "degrees"),
  lookup("fieldOfStudy", "student", "fields_of_study"),

  /* ── The work ────────────────────────────────────────────────────── */
  text("thesisCode", "thesis", 50, { format: "code" }),
  text("thesisTitle", "thesis", 1000),
  lookup("researchType", "thesis", "research_types"),

  /*
   * ── The board, as written names ──────────────────────────────────
   *
   * Text, every one, and the professor directory is only a spelling
   * suggestion behind them. The council appoints guest reviewers from other
   * universities who are not in this institution's directory and never will
   * be; a picker that refused those names would make real sittings
   * unrecordable.
   */
  ...SUPERVISION_SEATS.map((key) => text(key, "panel", 300)),
  ...BOARD_SEATS.map((key) => text(key, "panel", 300)),

  /* ── Who signs the worksheets ────────────────────────────────────── */
  text("facultyDean", "officers", 200),
  text("departmentCouncil", "officers", 200),
  text("educationOffice", "officers", 200),
  text("educationalCulturalDeputy", "officers", 200),
  text("researchDeputy", "officers", 200),
  text("departmentHead", "officers", 200),
  text("groupManager", "officers", 200),

  /* ── The defence sitting, which is not the council's own ─────────── */
  date("defenseMeetingDate", "defense"),
  text("defenseMeetingTime", "defense", 50),
  lookup("defenseMeetingDay", "defense", "weekdays"),
  text("defenseMeetingLocation", "defense", 200),
  date("proposalDefenseDate", "defense"),

  /* ── Paperwork ───────────────────────────────────────────────────── */
  paper("finalProposalFile", "proposalDocs"),
  paper("proposalDefensePermitForm", "proposalDocs"),
  paper("researchBackground", "proposalDocs"),
  paper("similarityCertificate", "proposalDocs"),
  paper("labSafetyCertificate", "proposalDocs"),
  paper("bioethicsCertificate", "proposalDocs"),
  text("bioethicsCode", "proposalDocs", 100, { format: "code" }),
  paper("languageCertificate", "proposalDocs"),

  paper("thesisFile", "defenseDocs"),
  paper("defensePermitForm", "defenseDocs"),
  paper("defenseSimilarityCertificate", "defenseDocs"),
  paper("defenseLanguageCertificate", "defenseDocs"),
  paper("researchPerformanceReports", "defenseDocs"),

  /* ── What was resolved ───────────────────────────────────────────── */
  text("decisionText", "text", 4000),
  text("achievements", "text", 2000),
];

/* ── A ruling ─────────────────────────────────────────────────────────────── */

export const RULING_GROUPS: readonly CouncilGroup[] = ["meeting", "text"];

export const RULING_FIELDS: readonly CouncilField[] = [
  text("meetingNumber", "meeting", 50, { required: true, format: "sittingNumber" }),
  date("meetingDate", "meeting"),
  text("meetingTime", "meeting", 50, { format: "clockText" }),
  lookup("meetingDay", "meeting", "weekdays"),
  text("meetingLocation", "meeting", 200),
  lookup("reportCategory", "meeting", "ruling_report_categories"),
  lookup("reviewStatus", "meeting", "council_review_statuses"),

  text("decisionText", "text", 4000, { required: true }),
  text("decisionDescription", "text", 4000),
];

/* ── An appointment ───────────────────────────────────────────────────────── */

export const APPOINTMENT_GROUPS: readonly CouncilGroup[] = ["meeting", "student", "seats"];

/** The three chairs an appointment fills, in the order the minute reads them. */
export const APPOINTMENT_SEATS = [
  "primarySupervisorId",
  "secondarySupervisorId",
  "thirdSupervisorId",
] as const;

export const APPOINTMENT_FIELDS: readonly CouncilField[] = [
  text("meetingNumber", "meeting", 50, { required: true, format: "sittingNumber" }),
  date("meetingDate", "meeting"),
  text("meetingTime", "meeting", 50, { format: "clockText" }),
  lookup("meetingDay", "meeting", "weekdays"),
  text("meetingLocation", "meeting", 200),

  text("studentNumber", "student", 20, { format: "digits" }),
  text("studentName", "student", 300),
  lookup("educationLevel", "student", "degrees"),
  lookup("fieldOfStudy", "student", "fields_of_study"),

  /*
   * Real references, unlike the decision's board.
   *
   * An appointment is this institution appointing its own staff — a supervisor
   * from another university is not something the council can resolve — so these
   * three are ids into the professor directory rather than free text. That is
   * also what lets «کدام دانشجویان را فلان استاد راهنمایی می‌کند» be a query
   * rather than a search for a spelling.
   */
  ...APPOINTMENT_SEATS.map(
    (key): CouncilField => ({ key, kind: "reference", group: "seats", references: "professor" }),
  ),
];

/**
 * The two checklists, as the record page counts them.
 *
 * The office's question is «چند تا جای خالی مانده» — how many items of the
 * dossier are still missing — so the record page counts them rather than
 * printing thirteen ticks and leaving the arithmetic to a person.
 */
export const CHECKLISTS: readonly { group: CouncilGroup; fields: readonly string[] }[] = [
  {
    group: "proposalDocs",
    fields: DECISION_FIELDS.filter(
      (field) => field.group === "proposalDocs" && field.kind === "boolean",
    ).map((field) => field.key),
  },
  {
    group: "defenseDocs",
    fields: DECISION_FIELDS.filter(
      (field) => field.group === "defenseDocs" && field.kind === "boolean",
    ).map((field) => field.key),
  },
];

/** Every vocabulary the council's records need, for one `lookupTable` call. */
export const COUNCIL_LOOKUP_SETS: readonly string[] = [
  ...new Set(
    [...MEETING_FIELDS, ...DECISION_FIELDS, ...RULING_FIELDS, ...APPOINTMENT_FIELDS]
      .map((field) => field.set)
      .filter((set): set is string => Boolean(set)),
  ),
];

export function fieldsIn(fields: readonly CouncilField[], group: CouncilGroup): CouncilField[] {
  return fields.filter((field) => field.group === group);
}

/** Catalogue key for a council field. Spelled once so the lookup cannot drift. */
export function councilLabelKey(field: CouncilField): string {
  return `field.${field.key}`;
}
