import { toLocaleDigits } from "@/lib/digits.ts";
import type { LookupTable } from "@/lib/lookups.ts";
import type { PanelRegister } from "@/modules/worksheets/queries.ts";
import { isDoctorate, printedValue } from "@/modules/worksheets/values.ts";

/**
 * The three things a printed form asks of the world outside it: a caption, a
 * value, and who a name belongs to.
 *
 * Bundled so the blocks can be plain functions of their input. Every one is
 * settled once, on the server, before a section is drawn — the alternative is a
 * renderer that reaches for a translator and a database, and then a form which
 * cannot be rendered anywhere but on a page.
 */

/** How this build spells the honorific, added once. */
const PERSIAN_HONORIFIC = /^(دکتر|دكتر|دکتور|پروفسور)\s/u;
const ENGLISH_HONORIFIC = /^(?:Dr\.?|Professor|Prof\.?)\s+/iu;

/**
 * «دکتر» in front of a name, unless it is already there.
 *
 * Both the register and the decision record sometimes carry it, so a second one
 * is a real risk: a form whose opening line reads «سرکار خانم دکتر دکتر عبداله
 * جمشیدی» is a form somebody has to retype.
 */
export function withDoctor(name: string, locale = "fa"): string {
  const written = name.trim();
  if (written === "") return "";
  if (locale.toLowerCase().startsWith("fa")) {
    return PERSIAN_HONORIFIC.test(written) ? written : `دکتر ${written}`;
  }
  return ENGLISH_HONORIFIC.test(written) ? written : `Dr. ${written}`;
}

/** One person, as a panel row, a roster line or a signature box states them. */
export interface SheetPerson {
  /** The name under its honorific, as the minutes spell it. */
  name: string;
  /** The academic rank, or "" where the register could not answer. */
  rank: string;
  /** The faculty served, or "" where the register could not answer. */
  affiliation: string;
}

const NOBODY: SheetPerson = { name: "", rank: "", affiliation: "" };

/** The register, as the document asks it: a minuted name in, a person out. */
export type Panel = (name: string) => SheetPerson;

export interface Words {
  /** A message key to the word it stands for. */
  t: (key: string) => string;
  /** A message key with the record's own values substituted into it. */
  fill: (key: string) => string;
  /** A column of the record, as the sheet writes it. */
  display: (field: string) => string;
  /** A document-localised figure. */
  figures: (value: number) => string;
  /** A compact list with punctuation appropriate to the document locale. */
  join: (parts: string[]) => string;
}

/**
 * A translator that has been told what the record holds.
 *
 * The forms are letters, not tables — «آمادگی آقای {student} … جهت دفاع» only
 * reads correctly with the values inside the sentence. Anything the record does
 * not hold becomes an ellipsis, so the sheet carries a blank to complete by
 * hand rather than the word "undefined".
 *
 * The substitution is handed to the message formatter rather than done here
 * with a regular expression: `{student}` is ICU syntax, so the catalogue lookup
 * already consumes it and a second pass would only see a sentence with the
 * placeholders silently removed.
 */
export function sheetWords({
  decision,
  lookups,
  translate,
  letterhead,
  panel,
  locale,
}: {
  decision: Record<string, unknown>;
  lookups: LookupTable;
  translate: (key: string, values?: Record<string, string>) => string;
  letterhead: { name: string; faculty: string; named: boolean };
  panel: Panel;
  locale: string;
}): Words {
  const display = (field: string) => printedValue(decision, lookups, field);

  /**
   * A ruled blank inside a sentence — the same mark the forms already use where
   * they ask for something the record does not hold, so a gap in prose reads as
   * a gap rather than as an omission.
   */
  const BLANK = "………";

  /**
   * A person named in a sentence, under their honorific — or a blank.
   *
   * The blank is the part that matters. Two forms open by addressing the head
   * of department, and with nothing on the record the address came out «مدیر
   * محترم گروه ،» — a dangling comma where a name belongs, which reads as a
   * printing fault rather than as something to complete. `display` already
   * writes an ellipsis for an empty column; this is the same mark surviving the
   * trip through the register.
   */
  const named = (field: string) => {
    const written = panel(display(field)).name;
    return written === "" ? BLANK : written;
  };

  const values: Record<string, string> = {
    thesisType: translate(isDoctorate(decision) ? "sheet.word.dissertation" : "sheet.word.thesis"),
    student: display("student_name"),
    studentNumber: display("student_number"),
    degree: display("education_level"),
    field: display("field_of_study"),
    thesis: display("thesis_title"),
    thesisCode: display("thesis_code"),
    /* The bare name: the one sentence taking this opens «جناب آقای دکتر / سرکار
       خانم دکتر {supervisor}», so the honorific is already in the address. */
    supervisor: display("primary_supervisor"),
    /* The section, not the person who manages it. Both sentences taking this
       name a بخش / گروه; bound to the group manager they would address a
       supervisor as «عضو محترم هیات علمی بخش» followed by a colleague's name. */
    department: display("department_council"),
    meeting: display("meeting_number"),
    meetingDate: display("meeting_date"),
    date: display("defense_meeting_date"),
    day: display("defense_meeting_day"),
    time: display("defense_meeting_time"),
    place: display("defense_meeting_location"),
    /* The head of department under their honorific — two forms open by
       addressing them, and an address with nobody in it is not an address. */
    groupManager: named("group_manager"),
    representative: display("graduate_studies_representative"),
    representativeTitled: named("graduate_studies_representative"),
    /*
     * The institution's name, or a ruled blank — never a fallback word.
     *
     * The originality declaration's third undertaking assigns the intellectual
     * property in the work: «کلیه حقوق مترتب از این اثر … متعلق به {university}
     * می‌باشد». With nothing entered, substituting a generic word would print a
     * rights assignment, on a document a student signs, naming no party — and
     * it would not look like a blank. A rule cannot be mistaken for an answer,
     * it does not stop the office printing, and the screen says so above the
     * preview before the sheet comes out.
     */
    university: letterhead.named ? letterhead.name : BLANK,
    faculty: letterhead.named && letterhead.faculty !== "" ? letterhead.faculty : BLANK,
  };

  return {
    t: (key) => translate(key),
    fill: (key) => translate(key, values),
    display,
    figures: (value) => toLocaleDigits(String(value), locale),
    join: (parts) => parts.join(locale.toLowerCase().startsWith("fa") ? "، " : ", "),
  };
}

/**
 * The register, bound to what it was able to answer.
 *
 * Keyed by the minuted name, which is also what is printed: a minute must go on
 * saying what it said, whatever the register calls the person now, and the
 * folding that connects the two happens in the query rather than here. What the directory
 * supplies is the rank and the faculty — and where it recognised nobody, those
 * stay blank so the form rules a line for the sitting to complete in ink. That
 * is the honest rendering for a guest examiner from another university, which
 * is most of what a miss actually is.
 */
export function panelFrom(register: PanelRegister, locale = "fa"): Panel {
  return (name) => {
    const written = typeof name === "string" ? name.trim() : "";
    /* `display` writes an ellipsis where the record holds nothing. */
    if (written === "" || written === "…") return NOBODY;
    const held = register.get(written);
    return {
      name: withDoctor(written, locale),
      rank: held?.rank ?? "",
      affiliation: held?.affiliation ?? "",
    };
  };
}
