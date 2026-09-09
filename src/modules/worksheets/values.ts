import { toPersianDigits } from "@/lib/digits.ts";
import type { LookupTable } from "@/lib/lookups.ts";

/**
 * How a stored value is written on a printed form.
 *
 * A form asks the record for a column and gets back whatever the database holds:
 * a vocabulary key, an ISO date, a time. None of those is what goes on the
 * paper, and each has been wrong on paper somewhere — an ISO date wearing
 * Persian numerals, a degree printed as `professional_doctorate`.
 *
 * The rules live here, apart from the document, because they are not layout.
 * They answer one question — what does this column say when it is written down
 * — and the document, the readiness check and any future export have to give
 * the same answer.
 */

/** Columns whose stored value is a vocabulary key rather than a word. */
const VOCABULARY: Record<string, string> = {
  education_level: "degrees",
  field_of_study: "fields_of_study",
  research_type: "research_types",
  defense_meeting_day: "weekdays",
  meeting_day: "weekdays",
};

/** Every set the forms resolve a key through. */
export const SHEET_LOOKUP_SETS: readonly string[] = [
  "degrees",
  "fields_of_study",
  "research_types",
  "weekdays",
  /* Not read by any form — the screen names a case and groups the index by it,
     and the office words its own stages. */
  "worksheet_categories",
];

/** Columns holding an ISO date, which prints in the Jalali calendar. */
const DATE_FIELDS = new Set(["meeting_date", "defense_meeting_date", "proposal_defense_date"]);

/**
 * Columns whose digits are written in Persian numerals.
 *
 * Numbers, dates and times are read as Persian on these forms. Free text is
 * not: a thesis on «COVID-19» or a DOI is not improved by having its digits
 * rewritten, and a name is a name as its owner spells it.
 */
const LOCALISED_DIGITS = new Set([
  "meeting_number",
  "meeting_date",
  "meeting_time",
  "student_number",
  /* The office's own reference for the work. Left in Latin it would read «با کد
     65644» in the middle of a sentence whose every other number is Persian. */
  "thesis_code",
  "defense_meeting_date",
  "defense_meeting_time",
  "proposal_defense_date",
]);

/**
 * A date in the calendar the council works in, whoever printed the sheet.
 *
 * Jalali unconditionally — not the reader's interface language. These are the
 * university's own instruments: a form signed and filed in Mashhad carries the
 * Persian calendar whether the clerk who pressed print had the application in
 * Persian or in English, exactly as its digits do. `2-digit` because the paper
 * writes «۱۴۰۵/۰۲/۳۰», not «۱۴۰۵/۲/۳۰».
 */
const JALALI = new Intl.DateTimeFormat("fa-u-ca-persian-nu-arabext", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

function sheetDate(value: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : JALALI.format(parsed);
}

/** The word a vocabulary key stands for, or the key itself if it is unknown. */
function worded(lookups: LookupTable, set: string, value: string): string {
  return lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value;
}

/**
 * A field's printable value: vocabulary resolved, calendar and digits applied.
 *
 * An ellipsis for anything the record does not hold, so the sheet carries a
 * blank to complete in ink rather than the word "undefined" or a gap that reads
 * as an answer of "none".
 */
export function printedValue(
  decision: Record<string, unknown>,
  lookups: LookupTable,
  field: string,
): string {
  const value = decision[field];
  if (value === null || value === undefined || value === "") return "…";

  const set = VOCABULARY[field];
  const text = DATE_FIELDS.has(field)
    ? sheetDate(String(value))
    : set
      ? worded(lookups, set, String(value))
      : String(value);

  return LOCALISED_DIGITS.has(field) ? toPersianDigits(text) : text;
}

/**
 * A thesis or a dissertation, depending on the degree.
 *
 * Persian uses two different words and the forms switch between them
 * throughout their prose. Printing one of them on every sheet reads as a
 * clerical error to the people who sign these.
 *
 * A doctoral candidate writes a رساله; everybody else — including a residency
 * under «دستیاری تخصصی», which is a specialist qualification and not a
 * doctorate — writes a پایان‌نامه.
 */
export function isDoctorate(decision: Record<string, unknown>): boolean {
  return decision.education_level === "phd";
}

/**
 * Whether a section restricted to one degree prints on this record's sheet.
 *
 * Exact keys, because the vocabulary is a closed list this application owns:
 * `phd` is the specialist doctorate whose research output must be evidenced
 * before it may defend, and `professional_doctorate` is the one that sits a
 * comprehensive exam. `specialty` is a residency and gets neither — a clause
 * marked «ویژه دکتری عمومی» on a residency's form is a requirement the faculty
 * did not make.
 */
export function sectionApplies(only: string | undefined, decision: Record<string, unknown>) {
  if (!only) return true;
  return only === "doctorate"
    ? decision.education_level === "phd"
    : decision.education_level === "professional_doctorate";
}
