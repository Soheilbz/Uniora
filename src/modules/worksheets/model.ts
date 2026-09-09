/**
 * The forms the research office prints, signs and files.
 *
 * A worksheet is one A4 page built from a council decision: the office picks a
 * case, picks a form, and gets a sheet to sign. Fourteen of them — seven for a
 * proposal, seven for a defence — and every one is an administrative instrument
 * rather than a summary of a record. A sheet missing its declaration paragraph,
 * its tick-boxes or its document-control code is not the form the university
 * files; it is a list of field values.
 *
 * So a form is described here as blocks, and one renderer turns that into the
 * page. The wording lives in the message catalogue, where it can be corrected
 * without touching code, and the house style lives in one stylesheet, so all
 * fourteen move together rather than drifting apart a form at a time.
 *
 * No imports: these definitions are read by the printable document, which is a
 * server component, and by the picker beside it, which is not.
 */

/** A caption and the column its value comes from. */
export interface SheetRow {
  /** Column on the decision record; omitted for a ruled blank to complete. */
  field?: string;
  /**
   * A second column printed after the first, joined by a dash.
   *
   * One caption answers with two columns: the notices head their first pod
   * «روز و تاریخ برگزاری» and fill it «سه‌شنبه - ۱۴۰۵/۰۲/۰۸». Bound to the
   * weekday alone it would name the day of the week a defence is held and never
   * say which week.
   */
  also?: string;
  label: string;
  /**
   * A word printed in front of the value, part of the value rather than of the
   * caption. A notice writes «ساعت ۱۱:۳۰» under a pod already headed «ساعت
   * برگزاری جلسه»; without it the pod reads as a bare number.
   */
  prefix?: string;
  /** Runs the full width — titles and long text. */
  wide?: boolean;
}

/**
 * One criterion on a mark sheet, and what it is worth.
 *
 * The mark is optional because one of the two forms carries none: the final
 * defence lists what the panel weighs and then takes a single mark for the
 * work, in figures and in words. Printing a maximum beside each of its eleven
 * criteria would state a scheme the university never published.
 */
export interface RubricCriterion {
  label: string;
  max?: number;
  /** Groups criteria under a shared heading, as the paper form does. */
  group?: string;
}

/**
 * A row of a panel table: the seat as the form words it, and the column the
 * name comes from.
 *
 * A bare string is the common case, where the role's own message key names the
 * column — `decisions.field.reviewer1` is `reviewer1`. The pair exists for rows
 * whose wording is the *form's* rather than the record's: one sheet says «استاد
 * راهنما اول» and another «استاد راهنمای دوم (در صورت وجود)». Neither is a
 * column name, so neither can be derived into one — a form-worded seat must
 * name its column or the cell has nothing to read.
 */
export type PanelRole = string | { label: string; field: string };

/** Somebody who signs, and how much of a box they need. */
export interface SignatureSpec {
  label: string;
  /**
   * Rules an academic rank and a faculty as well as the name. The paper asks
   * for all three where the signatory appears nowhere else on the sheet — the
   * originality declaration is signed by supervisors named in no table on it.
   */
  detailed?: boolean;
  /**
   * The column holding the signatory's name, where the label does not say.
   *
   * A signature box on these forms is not a blank: the deputy's name is printed
   * under «معاون پژوهشی …» and only the rule is inked. Labels that are
   * themselves record columns are derived, as a panel row is; this states the
   * rest.
   */
  field?: string;
  /**
   * Rules «تاریخ و امضا» rather than «امضا». The originality declaration is the
   * one sheet whose signatories date their own signature, because the
   * undertaking is made on a day rather than filed against a sitting the head
   * of the page has already dated.
   */
  dated?: boolean;
  /**
   * Printed as a sentence — «نماینده تحصیلات تکمیلی: دکتر محسن مالکی» — rather
   * than as a ruled box. The bound minute is a letter and names its four
   * countersigning officers at the foot in prose; four ruled boxes there would
   * make a filing form of the one sheet that is not one.
   */
  inline?: boolean;
}

export type SheetBlock =
  /** Formal prose addressed to an officer; placeholders fill at render time. */
  | { kind: "paragraph"; text: string }
  /** Captions and values from the record. */
  | { kind: "fields"; rows: SheetRow[] }
  /** Outcomes printed as boxes to tick. */
  | { kind: "choices"; options: string[]; label?: string }
  /** A numbered list of undertakings — the originality declaration. */
  | { kind: "declarations"; items: string[] }
  /** The panel, as the ruled table the form actually draws. */
  | { kind: "panel"; columns: string[]; roles: PanelRole[] }
  /**
   * The same people written out as a numbered list, which is how the bound
   * minute names them. That sheet reads as a letter and rules no tables at all.
   */
  | { kind: "roster"; title: string; roles: PanelRole[] }
  /** The one line the bound minute leaves for the grade awarded. */
  | { kind: "grade"; label: string }
  /**
   * A mark sheet. `total` is what the form adds up to; a form taking a single
   * mark for the whole work states no maxima and so carries no total.
   */
  | { kind: "rubric"; criteria: RubricCriterion[]; total?: number }
  /**
   * A ruled area for free handwriting — and, where the record holds what the
   * form asks for, that value written onto the first rule. The council's own
   * note belongs in «توضیحات» rather than leaving it blank on the sheet that
   * records the council's decision.
   */
  | { kind: "blank"; label: string; lines?: number; field?: string }
  /** Small print under the body. */
  | { kind: "note"; text: string };

export interface SheetSection {
  /** Printed before the title, as on the paper form. */
  number?: number;
  title?: string;
  blocks: SheetBlock[];
  signatures?: SignatureSpec[];
  /**
   * Small print *under* the signature boxes rather than above them. Two forms
   * carry one and both print it at the very foot of the section, below the
   * boxes — which a `note` block cannot express, because blocks all come first.
   */
  footnote?: string;
  /**
   * Restricts the section to one kind of student. The comprehensive-exam block
   * and the research-output clause each belong to one degree's form only.
   */
  only?: "doctorate" | "professionalDoctorate";
}

/**
 * The four shapes of head and foot.
 *
 * These are not styling choices. A worksheet is headed by the form's name and
 * its reference block because it is filed against a case; the bound minute is
 * headed by a registration number alone because it is bound into the thesis and
 * the case reference is on the sheet behind it; a notice carries neither
 * because it is pinned to a board. Printing one form's chrome on another is a
 * visible difference on the paper the office files, so every sheet says which
 * of the four it is rather than inheriting a default.
 *
 * - `form`        letterhead, the form's name with the degree after it,
 *                 «شماره» and «تاریخ» — and «شماره ثبت» on the three that carry
 *                 it — and the document-control footer.
 * - `declaration` letterhead and the form's name without a degree; no reference
 *                 block. The originality declaration.
 * - `minute`      «شماره ثبت» alone: no name, no reference block.
 * - `notice`      the notice's own heading and the degree beneath it; no
 *                 letterhead band, no reference block, no control footer.
 */
export type SheetChrome = "form" | "declaration" | "minute" | "notice";

/** Which date the reference block at the head of a form prints. */
export type ReferenceDate = "meeting" | "defense";

export interface SheetDef {
  id: string;
  /** How the form is named in the index the office picks from. */
  labelKey: string;
  /**
   * How the form names *itself* at the head of the printed sheet.
   *
   * Separate from `labelKey` because they are not the same words: the index
   * offers «کاربرگ جامع انتخاب استاد راهنما» and the sheet that comes out is
   * headed «کاربرگ انتخاب استاد راهنما», with the degree after it. Printing the
   * index entry would retitle most of the fourteen.
   *
   * Omitted on the two notices, which carry their heading in the body and have
   * no letterhead title above it.
   */
  titleKey?: string;
  /** The head and foot this sheet prints. Defaults to `form`. */
  chrome?: SheetChrome;
  /**
   * A notice's second line — «پایان‌نامه مقطع کارشناسی ارشد». It names the
   * degree, which every other sheet carries in parentheses after its title; a
   * poster with no degree on it does not say what is being defended.
   */
  subtitleKey?: string;
  /**
   * The sitting the reference block dates the sheet by. Most forms are dated by
   * the council that authorised them; the three that arrange or record a
   * defence are dated by the defence, because the sheet is about that day.
   */
  referenceDate?: ReferenceDate;
  /**
   * Whether the reference block carries «شماره ثبت». Three forms do. Printing a
   * blank rule for it on all fourteen would put a field on eleven forms the
   * university never ruled there.
   */
  registration?: boolean;
  /** Which stage of a case this form belongs to; groups the index. */
  category: string;
  /**
   * The office's own code for the form, printed in the footer. A form without
   * one is not accepted for filing.
   *
   * Optional because the two defence announcements do not carry one — they are
   * notices pinned to a board, not forms filed against a case, and inventing a
   * code would put an official identifier on a document the university never
   * issued one for.
   */
  formCode?: string;
  /**
   * Small print carried in the document-control footer, at the very foot of the
   * page — not in the body, above the table of the people it is about.
   */
  footnote?: string;
  sections: SheetSection[];
}
