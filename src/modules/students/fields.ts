/**
 * A student record, described once.
 *
 * The detail page, the form and the validator all read this list. That is the
 * point of it: a record with fifty fields maintained as three parallel lists —
 * one that displays, one that edits, one that checks — drifts, and the way it
 * drifts is that somebody adds a field to the form and not to the validator, so
 * the new field is the one field nobody validates.
 *
 * Pure, like `model.ts` and for the same reason: the form is a client component.
 * Nothing here may import drizzle or the schema.
 */

import type { FieldSpec as RegisterFieldSpec } from "@/lib/register/field-spec.ts";

export type { FieldFormat, FieldKind } from "@/lib/register/field-spec.ts";

export type FieldGroup = "identity" | "academic" | "contact" | "history";
export type FieldSpec = RegisterFieldSpec<FieldGroup>;

/**
 * The four sections a registry office works through, in that order.
 *
 * It is the order of the paper file, not a designer's grouping: somebody
 * transcribing a folder works top to bottom and the form has to follow the
 * document in their other hand.
 */
export const FIELD_GROUPS: readonly FieldGroup[] = ["identity", "academic", "contact", "history"];

const text = (
  key: string,
  group: FieldGroup,
  maxLength: number,
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({ key, kind: "text", group, maxLength, ...extra });

/* A lookup is a suggestion source. The record form may still accept a value
   that has not reached the administrator-maintained vocabulary yet. */
const lookup = (
  key: string,
  group: FieldGroup,
  set: string,
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({ key, kind: "lookup", group, set, allowCustom: true, ...extra });

const date = (key: string, group: FieldGroup): FieldSpec => ({ key, kind: "date", group });

const number = (
  key: string,
  group: FieldGroup,
  min: number,
  max: number,
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({ key, kind: "number", group, min, max, scale: 0, ...extra });

/** Grade points, on the Iranian 0–20 scale, to two places. */
const gpa = (key: string): FieldSpec => number(key, "history", 0, 20, { scale: 2 });

const flag = (key: string, group: FieldGroup): FieldSpec => ({ key, kind: "boolean", group });

const supervisor = (key: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  kind: "reference",
  group: "academic",
  references: "professor",
  ...extra,
});

export const STUDENT_FIELDS: readonly FieldSpec[] = [
  /* ── Identity ─────────────────────────────────────────────────────────── */
  text("studentNumber", "identity", 20, { format: "digits", required: true }),
  text("nationalId", "identity", 20, { format: "nationalId", hint: "field.nationalIdHint" }),
  text("idNumber", "identity", 20, { format: "digits" }),
  text("firstName", "identity", 200, { required: true }),
  text("lastName", "identity", 200, { required: true }),
  text("fatherName", "identity", 200),
  lookup("gender", "identity", "genders"),
  lookup("maritalStatus", "identity", "marital_statuses"),
  lookup("nationality", "identity", "nationalities"),
  date("birthDate", "identity"),
  // Jalali years. Not a date, because the archive holds people whose file gives
  // «۱۳۶۲» and no day — see the schema.
  number("birthYear", "identity", 1280, 1500, { hint: "field.birthYearHint" }),
  text("birthPlace", "identity", 200),
  // Alphanumeric, unlike every other identifier on this form.
  text("passportNumber", "identity", 30, { format: "code" }),
  lookup("militaryStatusType", "identity", "military_status_types"),
  lookup("militaryStatus", "identity", "military_statuses"),

  /* ── Academic standing ────────────────────────────────────────────────── */
  lookup("degree", "academic", "degrees"),
  lookup("status", "academic", "student_statuses", { required: true }),
  date("admissionDate", "academic"),
  lookup("sourceUniversity", "academic", "universities"),
  lookup("faculty", "academic", "faculties"),
  lookup("department", "academic", "departments", { narrowedBy: "faculty" }),
  lookup("fieldOfStudy", "academic", "fields_of_study", { narrowedBy: "department" }),
  supervisor("primarySupervisorId", { hint: "field.supervisorHint" }),
  supervisor("secondarySupervisorId"),
  supervisor("thirdSupervisorId"),
  supervisor("advisorId"),
  lookup("admissionType", "academic", "admission_types"),
  lookup("fundingType", "academic", "funding_types"),
  lookup("entryMethod", "academic", "entry_methods"),
  lookup("quota", "academic", "quotas"),

  /* ── Contact ──────────────────────────────────────────────────────────── */
  text("phone", "contact", 50, { format: "tel" }),
  text("email", "contact", 300, { format: "email" }),

  /* ── Prior degree and progress ────────────────────────────────────────── */
  lookup("previousUniversity", "history", "universities"),
  text("previousStudentNumber", "history", 20, { format: "digits" }),
  text("previousField", "history", 100),
  gpa("previousGpa"),
  date("previousGraduationDate", "history"),
  flag("previousGraduationConfirmed", "history"),
  gpa("overallGpa"),
  lookup("diplomaType", "history", "diploma_types"),
  gpa("diplomaWrittenGpa"),
  gpa("diplomaGpa"),
  number("completedUnits", "history", 0, 500),
  number("currentSemesterUnits", "history", 0, 100),
  number("semestersCount", "history", 0, 40, { hint: "field.semestersCountHint" }),
  flag("academicStatusIncluded", "history"),
  flag("academicStatusExcluded", "history"),
  lookup("militaryLetterStatus", "history", "military_letter_statuses"),
];

/** The label key for a field, so the catalogue lookup is spelled once. */
export function labelKey(field: FieldSpec): string {
  /*
   * `fieldOfStudy` reads «رشته» and its catalogue key is `field.field`, because
   * that is what the office calls it and what the register's filter is named.
   * The column could not be `field` — `field_of_study` is what the schema uses
   * to avoid a reserved-ish name — so the one mapping lives here rather than
   * being a special case at four call sites.
   */
  const key = field.key === "fieldOfStudy" ? "field" : field.key;
  return `field.${key}`;
}

/** Every vocabulary a student record needs, for one `lookupTable` call. */
export const STUDENT_LOOKUP_SETS: readonly string[] = [
  ...new Set(STUDENT_FIELDS.map((field) => field.set).filter((set): set is string => Boolean(set))),
];

export function fieldsIn(group: FieldGroup): FieldSpec[] {
  return STUDENT_FIELDS.filter((field) => field.group === group);
}
