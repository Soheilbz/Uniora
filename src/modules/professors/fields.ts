import type { FieldSpec } from "@/lib/register/field-spec.ts";

/**
 * A professor's record, described once.
 *
 * The detail page, the form and the validator all read this list — the same
 * arrangement the student register uses, and for the same reason: a record with
 * thirty fields kept as three parallel lists drifts, and the way it drifts is
 * that somebody adds a field to the form and not to the validator, so the new
 * field is the one nobody checks.
 *
 * The `FieldSpec` vocabulary is shared by every register rather than copied,
 * so the generic engine and each domain answer the same field-shape questions.
 *
 * Pure: the form is a client component and nothing here may reach drizzle.
 */

/**
 * The four sections of the personnel file, in the order a clerk works through
 * it — identity, then standing, then employment, then how the office reaches
 * and pays them.
 */
export const PROFESSOR_GROUPS = ["identity", "academic", "employment", "contact"] as const;
export type ProfessorGroup = (typeof PROFESSOR_GROUPS)[number];
export type ProfessorFieldSpec = FieldSpec<ProfessorGroup>;

type Group = ProfessorGroup;

const text = (
  key: string,
  group: Group,
  maxLength: number,
  extra: Partial<ProfessorFieldSpec> = {},
): ProfessorFieldSpec => ({ key, kind: "text", group, maxLength, ...extra });

const lookup = (
  key: string,
  group: Group,
  set: string,
  extra: Partial<ProfessorFieldSpec> = {},
): ProfessorFieldSpec => ({
  key,
  kind: "lookup",
  group,
  set,
  allowCustom: true,
  ...extra,
});

const date = (key: string, group: Group): ProfessorFieldSpec => ({
  key,
  kind: "date",
  group,
});

/**
 * Yes, no, and the third answer a checkbox cannot hold: nothing recorded.
 *
 * The values are the words themselves rather than `true`/`false`, so what the
 * column holds reads the same in a query, an export and a printed return as it
 * does on the screen.
 */
export const YES_NO = [
  { value: "yes", labelKey: "common.yes" },
  { value: "no", labelKey: "common.no" },
] as const;

export const PROFESSOR_FIELDS: readonly ProfessorFieldSpec[] = [
  /* ── Identity ─────────────────────────────────────────────────────────── */
  text("professorCode", "identity", 30, { format: "code", hint: "field.professorCodeHint" }),
  text("firstName", "identity", 200, { required: true }),
  text("lastName", "identity", 200, { required: true }),
  text("fatherName", "identity", 200),
  text("nationalId", "identity", 20, { format: "nationalId", hint: "field.nationalIdHint" }),
  text("birthCertificateNumber", "identity", 20, { format: "digits" }),
  date("certificateIssueDate", "identity"),
  date("birthDate", "identity"),
  text("birthPlace", "identity", 200),
  lookup("gender", "identity", "genders"),
  lookup("maritalStatus", "identity", "marital_statuses"),
  lookup("nationality", "identity", "nationalities"),
  lookup("veteranStatus", "identity", "veteran_statuses"),

  /* ── Academic standing ────────────────────────────────────────────────── */
  lookup("academicRank", "academic", "academic_ranks"),
  /*
   * Whether this is a member of faculty or somebody teaching by the hour.
   *
   * A field rather than a note, because it decides what a person may be
   * appointed to: a visiting lecturer does not chair an examining board.
   *
   * Three states, not a checkbox. «Not recorded» is a real answer here — a
   * directory transcribed from a personnel file has records where the question
   * was never asked — and it is not the same as «no». Held as a boolean with a
   * default it became a stated «yes» on every one of them, which is precisely
   * the answer that qualifies somebody to chair a board.
   *
   * A choice and not a vocabulary because the answer is yes or no: an
   * administrator adding a third value to it in a settings screen would be
   * adding a value nothing in this application knows how to count.
   */
  {
    key: "isFacultyMember",
    kind: "choice",
    group: "academic",
    choices: YES_NO,
    hint: "field.isFacultyMemberHint",
  },
  lookup("lastDegree", "academic", "last_degrees"),
  text("specialization", "academic", 300),
  text("activityField", "academic", 300),
  lookup("faculty", "academic", "faculties"),
  lookup("department", "academic", "departments", { narrowedBy: "faculty" }),
  lookup("university", "academic", "universities"),

  /* ── Employment ───────────────────────────────────────────────────────── */
  /*
   * Vocabularies provide autocomplete suggestions, not a hard wall. This
   * matters for a personnel office: a new contract, workplace or dependency
   * can be transcribed immediately and later promoted into the shared list.
   * The suggestion still prevents the common spelling drift («رسمی قطعی» vs
   * «رسمی‌قطعی») when the value already exists.
   *
   * `employmentStatus` is the contract; `status` beside it is whether the
   * person is at their post. Universities report those separately, so they are
   * two fields rather than one.
   */
  lookup("employmentStatus", "employment", "employment_statuses"),
  lookup("status", "employment", "professor_statuses"),
  lookup("grade", "employment", "professor_grades"),
  date("hireDate", "employment"),
  lookup("dependency", "employment", "dependencies"),
  lookup("workplace", "employment", "workplaces"),
  lookup("workplaceRegion", "employment", "workplace_regions"),
  text("specialConditions", "employment", 500),
  text("notes", "employment", 2000),

  /* ── Contact and payment ──────────────────────────────────────────────── */
  text("email", "contact", 200, { format: "email" }),
  text("phone", "contact", 30, { format: "tel" }),
  text("virtualLink", "contact", 500),
  lookup("bankName", "contact", "banks"),
  /*
   * A bank account number, which is why the record and export show it only to a
   * professor manager. Digits, and stored as text: an account number has
   * leading zeros and is never arithmetic.
   */
  text("bankAccountNumber", "contact", 40, { format: "digits" }),
];

/**
 * Every vocabulary the professor form and record resolve a key through.
 *
 * Derived rather than typed out. Kept by hand it is a second list saying the
 * same thing as the first, and the way that fails is silent: a field converted
 * to a lookup whose set nobody added here renders as an empty select on the
 * form and as a bare stored value on the record — the field *looks* filled in,
 * and only its options are missing.
 */
export const PROFESSOR_LOOKUP_SETS: readonly string[] = [
  ...new Set(
    PROFESSOR_FIELDS.filter((field) => field.kind === "lookup" && field.set).map(
      (field) => field.set as string,
    ),
  ),
];
