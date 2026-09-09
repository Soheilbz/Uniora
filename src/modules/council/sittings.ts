/**
 * How a sitting's papers are assembled.
 *
 * Two documents come out of one meeting and they are not the same document.
 *
 * The **minute** is the record of what was resolved. It is written after the
 * sitting, in four lettered sections — (الف) proposals cleared for defence,
 * (ب) theses cleared for their final defence, (ج) everything else the council
 * ruled on, (د) the supervisors it appointed — and each resolution is stated in
 * full, ending in the verb of approval.
 *
 * The **checklist** is what the office carries *into* the sitting: the same
 * cases, but as a grid of which papers each file is still missing, four cases
 * to a page. Nothing has been approved yet when it is printed, so the approval
 * verb is stripped off the wordings that carry one.
 *
 * The grouping, ordering and wording rules live here rather than in the
 * components, because they are the part that has to keep matching the paper the
 * council signs — and because both documents read them, so a rule that lived in
 * one component would be a rule the other could drift away from.
 */

/** A decision as the two documents read it: every column they might print. */
export interface SittingDecision {
  id: string;
  studentNumber: string | null;
  studentName: string | null;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  thesisTitle: string | null;
  reportCategory: string | null;
  reviewStatus: string | null;
  councilNotes: string | null;
  proposalDefenseDate: string | null;
  achievements: string | null;
  bioethicsCode: string | null;

  finalProposalFile: boolean | null;
  proposalDefensePermitForm: boolean | null;
  researchBackground: boolean | null;
  similarityCertificate: boolean | null;
  labSafetyCertificate: boolean | null;
  bioethicsCertificate: boolean | null;
  languageCertificate: boolean | null;
  thesisFile: boolean | null;
  defensePermitForm: boolean | null;
  defenseSimilarityCertificate: boolean | null;
  defenseLanguageCertificate: boolean | null;
  researchPerformanceReports: boolean | null;

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

/** A ruling as the two documents read it — section (ج). */
export interface SittingRuling {
  id: string;
  reportCategory: string | null;
  reviewStatus: string | null;
  decisionText: string | null;
  decisionDescription: string | null;
}

/** An appointment as the minute reads it — section (د). */
export interface SittingAppointment {
  id: string;
  studentNumber: string | null;
  studentName: string | null;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  supervisors: string[];
}

/**
 * Section (الف): a proposal being cleared for its defence.
 *
 * Exported because the examining statistics count proposal-stage decisions and
 * nothing else; the two must agree on what "proposal stage" means, and keeping
 * a second copy of the answer is how a build's screens come to disagree.
 */
export const PROPOSAL_CATEGORIES = new Set(["thesis_proposal", "dissertation_proposal"]);

/**
 * Section (ب): a finished thesis being cleared for its final defence.
 *
 * Exported for the same reason section (الف) is: the reviews report measures
 * how long a case waits between the sitting that appointed its panel and the
 * sitting that cleared its defence, and a second spelling of "reached its
 * defence" would let the two screens disagree about which cases are still
 * outstanding.
 */
export const DEFENCE_CATEGORIES = new Set(["thesis_final_defense", "dissertation_final_defense"]);

/** Cases per checklist page. The grid is four columns wide on A4. */
export const CHECKLIST_PAGE_SIZE = 4;

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A rejected item is not minuted.
 *
 * The council saw it and turned it down, so it belongs in the record of the
 * decision rather than in the list of things the sitting resolved to do.
 */
export function isRejected(row: { reviewStatus: string | null }): boolean {
  return str(row.reviewStatus).trim() === "rejected";
}

/**
 * A row with no student named on it is not a case.
 *
 * The register carries drafts — a category chosen, nothing else filled in yet —
 * and an empty column on a checklist is a column the office cannot chase.
 */
function namesAStudent(row: SittingDecision): boolean {
  return str(row.studentName).trim() !== "";
}

export interface SittingSections {
  proposals: SittingDecision[];
  defences: SittingDecision[];
  /**
   * Cases whose category neither section has a place for.
   *
   * Surfaced rather than dropped: a decision the documents have no section for
   * is nearly always a category code the screens do not recognise — a wrongly
   * imported sitting — and saying so beats printing a short, plausible minute.
   */
  unfiled: SittingDecision[];
}

export function splitDecisions(decisions: readonly SittingDecision[]): SittingSections {
  const usable = decisions.filter((row) => !isRejected(row) && namesAStudent(row));
  const proposals = usable.filter((row) => PROPOSAL_CATEGORIES.has(str(row.reportCategory)));
  const defences = usable.filter((row) => DEFENCE_CATEGORIES.has(str(row.reportCategory)));
  return {
    proposals,
    defences,
    unfiled: usable.filter(
      (row) =>
        !PROPOSAL_CATEGORIES.has(str(row.reportCategory)) &&
        !DEFENCE_CATEGORIES.has(str(row.reportCategory)),
    ),
  };
}

/**
 * Section (ج), in the order it is read out.
 *
 * «سایر موارد» last, everything else in the order it was filed.
 */
export function orderRulings(rulings: readonly SittingRuling[]): SittingRuling[] {
  const usable = rulings.filter((row) => !isRejected(row) && str(row.decisionText).trim() !== "");
  // Stable, so a category's own items stay in agenda order.
  return [...usable].sort((left, right) => {
    const leftOther = str(left.reportCategory) === "other" ? 1 : 0;
    const rightOther = str(right.reportCategory) === "other" ? 1 : 0;
    return leftOther - rightOther;
  });
}

/**
 * The council's own notes on the sitting, one item per line.
 *
 * They are numbered continuously with the rulings on the checklist, so they
 * arrive as a list rather than a paragraph.
 */
export function noteLines(notes: string | null): string[] {
  return str(notes)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Tidies the spacing of a stored resolution.
 *
 * Runs of whitespace collapse and a missing space after punctuation is added,
 * because these paragraphs are assembled from typed fragments and arrive with
 * both. Zero-width non-joiners are left alone: they are what makes «پایان‌نامه»
 * one word, and replacing them with spaces breaks every Persian compound in the
 * document.
 */
export function normalizeSpacing(text: string): string {
  return text
    .trim()
    .replace(/[ \t ]+/g, " ")
    .replace(/([،؛:.!?])(?=[^\s،؛:.!?])/g, "$1 ")
    .trim();
}

/**
 * Removes the verb of approval from a resolution.
 *
 * Used only on the checklist. The stock wordings end in «به تصویب رسید» or one
 * of its variants because they are written to be read *after* the vote; on the
 * sheet the council reads *before* voting, that ending asserts the outcome of a
 * decision it has not yet taken. The connective that introduced it («… مطرح و»)
 * goes with it, along with any comma left dangling.
 */
export function stripApproval(text: string): string {
  return text
    .replace(
      /\s*\(?\s*(به\s+تصویب\s+رسید|مورد\s+موافقت\s+قرار\s+گرفت|موافقت\s+گردید|تصویب\s+شد)\s*\.?\s*\)?\s*$/,
      "",
    )
    .trim()
    .replace(/\s*[،,]?\s*(مطرح\s+گردید\s+و|مطرح\s+و|مطرح|گردید)\s*$/, "")
    .trim()
    .replace(/\s*[،,]\s*$/, "")
    .trim();
}

/*
 * Checklist-presence columns are boolean; the two text fields remain text
 * because they carry a value rather than a yes/no answer:
 * `bioethics_code` is a code and `achievements` is a sentence. The checklist
 * ticks both — the office is asking whether the file has one at all — so the
 * test below has to answer for a boolean and for a string.
 */
const ABSENT = new Set(["ندارد", "خیر", "نه", "-", "—", "no", "none"]);

/**
 * Whether a required paper is in the file.
 *
 * Anything written counts as supplied unless it says outright that it is not:
 * «دارد (اسکن)» is a filed document, and a check that accepted only the bare
 * «دارد» printed it as missing and sent the office chasing a paper it already
 * had.
 */
export function isSupplied(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const written = str(value).trim();
  return written !== "" && !ABSENT.has(written.toLowerCase());
}

/**
 * Whether a panel seat was actually filled.
 *
 * Blank or an explicit placeholder means nobody was appointed. Placeholders
 * are never printed as academic names in a signed minute.
 */
export function isNamed(value: unknown): boolean {
  const written = str(value).trim();
  return written !== "" && !written.startsWith("[");
}

/**
 * Adds the doctoral honorific the council addresses every academic by.
 *
 * Applied at the document, not stored: the directory holds the name, and a
 * register that stored «دکتر» in front of it could not sort by surname.
 */
export function withHonorific(name: string, doctor: string): string {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.startsWith("[")) return trimmed;
  return trimmed.startsWith(doctor) ? trimmed : `${doctor} ${trimmed}`;
}

/** Splits a list into fixed-size pages, the last one short. */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < list.length; index += size) {
    pages.push(list.slice(index, index + size));
  }
  return pages;
}

export interface SittingTotals {
  /** Everything minuted in sections (الف) and (ب). */
  total: number;
  proposals: number;
  defences: number;
  rulings: number;
  notes: number;
  selections: number;
}

export function sittingTotals(
  sections: SittingSections,
  rulings: readonly SittingRuling[],
  notes: readonly string[],
  selections: readonly SittingAppointment[],
): SittingTotals {
  return {
    total: sections.proposals.length + sections.defences.length,
    proposals: sections.proposals.length,
    defences: sections.defences.length,
    rulings: rulings.length,
    notes: notes.length,
    selections: selections.length,
  };
}

/** A row of the checklist grid: one attribute, read down the side. */
export interface ChecklistRow {
  /** The catalogue key for the row's label. */
  label: string;
  /** The column it reads, or absent for a row assembled from several. */
  key?: keyof SittingDecision;
  kind: "text" | "tick" | "person" | "date" | "placement";
}

/** The rows of section (الف): what a proposal must carry into the sitting. */
export const PROPOSAL_ROWS: readonly ChecklistRow[] = [
  { label: "field.studentNumber", key: "studentNumber", kind: "text" },
  { label: "column.placement", kind: "placement" },
  { label: "row.title", key: "thesisTitle", kind: "text" },
  { label: "row.proposalFile", key: "finalProposalFile", kind: "tick" },
  { label: "field.proposalDefensePermitForm", key: "proposalDefensePermitForm", kind: "tick" },
  { label: "row.researchBackground", key: "researchBackground", kind: "tick" },
  { label: "row.similarity", key: "similarityCertificate", kind: "tick" },
  { label: "field.labSafetyCertificate", key: "labSafetyCertificate", kind: "tick" },
  { label: "field.bioethicsCertificate", key: "bioethicsCertificate", kind: "tick" },
  { label: "field.bioethicsCode", key: "bioethicsCode", kind: "tick" },
  { label: "field.languageCertificate", key: "languageCertificate", kind: "tick" },
  { label: "field.primarySupervisor", key: "primarySupervisor", kind: "person" },
  { label: "field.secondarySupervisor", key: "secondarySupervisor", kind: "person" },
  { label: "field.thirdSupervisor", key: "thirdSupervisor", kind: "person" },
  { label: "row.advisor1", key: "firstAdvisor", kind: "person" },
  { label: "row.advisor2", key: "secondAdvisor", kind: "person" },
  { label: "row.advisor3", key: "thirdAdvisor", kind: "person" },
  { label: "field.reviewer1", key: "reviewer1", kind: "person" },
  { label: "field.reviewer2", key: "reviewer2", kind: "person" },
  { label: "field.reviewer3", key: "reviewer3", kind: "person" },
  { label: "row.invitedReviewer", key: "reviewer4Invited", kind: "person" },
  { label: "row.remarks", key: "councilNotes", kind: "text" },
];

/** The rows of section (ب): what a completed thesis must contain. */
export const DEFENCE_ROWS: readonly ChecklistRow[] = [
  { label: "field.studentNumber", key: "studentNumber", kind: "text" },
  { label: "column.placement", kind: "placement" },
  { label: "row.title", key: "thesisTitle", kind: "text" },
  { label: "field.thesisFile", key: "thesisFile", kind: "tick" },
  { label: "field.defensePermitForm", key: "defensePermitForm", kind: "tick" },
  { label: "row.similarity", key: "defenseSimilarityCertificate", kind: "tick" },
  { label: "row.languageDocument", key: "defenseLanguageCertificate", kind: "tick" },
  { label: "row.performanceReports", key: "researchPerformanceReports", kind: "tick" },
  { label: "field.achievements", key: "achievements", kind: "text" },
  /*
   * A date, not text. The plain path prints the column as stored, and the
   * column is a `date` — so this row would put "2017-01-23" on a Persian
   * checklist for every case that carries one.
   */
  { label: "row.proposalDefenseDate", key: "proposalDefenseDate", kind: "date" },
  { label: "field.primarySupervisor", key: "primarySupervisor", kind: "person" },
  { label: "field.secondarySupervisor", key: "secondarySupervisor", kind: "person" },
  { label: "field.thirdSupervisor", key: "thirdSupervisor", kind: "person" },
  { label: "row.advisor1", key: "firstAdvisor", kind: "person" },
  { label: "row.advisor2", key: "secondAdvisor", kind: "person" },
  { label: "row.advisor3", key: "thirdAdvisor", kind: "person" },
  { label: "field.reviewer1", key: "reviewer1", kind: "person" },
  { label: "field.reviewer2", key: "reviewer2", kind: "person" },
  { label: "field.reviewer3", key: "reviewer3", kind: "person" },
  { label: "row.invitedReviewer", key: "reviewer4Invited", kind: "person" },
  {
    label: "field.graduateStudiesRepresentative",
    key: "graduateStudiesRepresentative",
    kind: "person",
  },
];

/**
 * Who the minute records as present, and who as missing.
 *
 * A substitution is effective only when the recorded deputy is actually on the
 * attendance roll. The substitution map is structured data and is the sole
 * source for representation; participant names remain plain names. A person
 * recorded as both present and absent is rendered as present while the stored
 * contradiction remains available to data-quality review.
 */
export interface Roll {
  present: { name: string; standsFor?: string }[];
  absent: string[];
}

export function attendance(
  participants: readonly string[],
  absentees: readonly string[],
  substitutions: Record<string, string>,
): Roll {
  const deputies = new Map(
    Object.entries(substitutions).map(([member, stand]) => [stand.trim(), member.trim()]),
  );
  const attended = new Set(participants.map((name) => name.trim()));
  const replaced = new Set(
    Object.entries(substitutions)
      .filter(([, deputy]) => attended.has(deputy.trim()))
      .map(([member]) => member.trim()),
  );

  return {
    present: participants.map((storedName) => {
      const standsFor = deputies.get(storedName.trim());
      return standsFor ? { name: storedName, standsFor } : { name: storedName };
    }),
    absent: absentees.filter((name) => !replaced.has(name.trim()) && !attended.has(name.trim())),
  };
}

/**
 * The degrees that write a رساله rather than a پایان‌نامه.
 *
 * The council's own nouns, and the minute reads wrong to the office without
 * them: a master's student does not defend a رساله, and a doctoral candidate's
 * work is not a پایان‌نامه. «دکتری حرفه‌ای» — the D.V.M — is deliberately *not*
 * here: it is a general doctorate and its work is a پایان‌نامه, which is the
 * distinction the office draws and the one a single «is it a doctorate» test
 * would get wrong.
 *
 * A set rather than a condition at the call site, because the same question is
 * asked by the minute, the worksheets and the examining statistics, and three
 * spellings of it is how they come to disagree about one student.
 */
const DISSERTATION_DEGREES = new Set(["phd", "specialty"]);

export function writesDissertation(educationLevel: string | null): boolean {
  return DISSERTATION_DEGREES.has(str(educationLevel).trim());
}
