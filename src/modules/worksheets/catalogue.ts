import { FINAL_SHEETS } from "./final.ts";
import type { PanelRole, SheetDef, SignatureSpec } from "./model.ts";
import { PROPOSAL_SHEETS } from "./proposal.ts";

/**
 * The index of forms, and the questions the screen asks about one.
 *
 * Kept apart from the definitions so the picker, the printable document and any
 * later readiness check all answer from the same list — «which forms may this
 * case be issued» and «which columns will print blank» are only consistent if
 * one file decides both.
 */

/** Canonical order: the seven proposal forms, then the seven defence forms. */
export const SHEETS: readonly SheetDef[] = [...PROPOSAL_SHEETS, ...FINAL_SHEETS];

export const SHEET_BY_ID = new Map(SHEETS.map((sheet) => [sheet.id, sheet]));

/**
 * The two halves of a case, as the office files them.
 *
 * A thesis passes the council twice: once to have its proposal approved, once
 * to be defended. The paper index has exactly these two headings, with seven
 * forms under each, and offers all seven whenever a record of that half is
 * chosen.
 *
 * Decision records identify only the proposal or final-defence stage. Form
 * categories such as supervisor selection and defence permit are worksheet
 * organisation keys, not stored council-decision categories.
 */
export type SheetStage = "proposal" | "final";

const STAGE_OF_CATEGORY: Readonly<Record<string, SheetStage>> = {
  supervisor_selection: "proposal",
  proposal: "proposal",
  thesis_proposal: "proposal",
  dissertation_proposal: "proposal",
  proposal_defense: "proposal",
  defense_permit: "final",
  final_defense: "final",
  thesis_final_defense: "final",
  dissertation_final_defense: "final",
};

/** Which half of a case a report category — or a form's own category — is in. */
export function stageOf(category: unknown): SheetStage | undefined {
  return STAGE_OF_CATEGORY[String(category ?? "")];
}

/** A form's own stage. Total, because every category above is mapped. */
export function stageOfSheet(sheet: SheetDef): SheetStage {
  return stageOf(sheet.category) ?? "proposal";
}

/**
 * The forms a record of this category is issued: all seven of its stage.
 *
 * A record whose category is not one of the five is offered everything rather
 * than nothing, because there is no evidence on which to withhold a form.
 */
export function sheetsFor(category: unknown): readonly SheetDef[] {
  const stage = stageOf(category);
  return stage ? SHEETS.filter((sheet) => stageOfSheet(sheet) === stage) : SHEETS;
}

/** The label a panel row is printed under. */
export function roleLabel(role: PanelRole): string {
  return typeof role === "string" ? role : role.label;
}

/**
 * The column a panel row reads its name from.
 *
 * Derived from the role's own key where the two coincide —
 * `decisions.field.reviewer4Invited` is `reviewer4_invited` — and stated
 * outright where they do not. It lives here rather than in the renderer because
 * anything asking "which of this form's fields will print blank" has to agree
 * with the renderer about which column each row draws on.
 */
export function roleField(role: PanelRole): string {
  if (typeof role !== "string") return role.field;
  return role
    .replace("decisions.field.", "")
    .replace(/[A-Z0-9]/g, (character) =>
      /[0-9]/.test(character) ? character : `_${character.toLowerCase()}`,
    );
}

/**
 * The column a signature box prints its holder's name from, if any.
 *
 * Stated on the spec where the label is the form's own wording — «نام و امضای
 * مدیر گروه» is not a column — and derived from the label otherwise, so the
 * roles that *are* record columns behave exactly as a panel row does. A box
 * with no column behind it, such as the research officer's, keeps its rule
 * blank rather than printing an ellipsis where a name would go.
 */
export function signatureField(signature: SignatureSpec): string | undefined {
  if (signature.field) return signature.field;
  return signature.label.startsWith("decisions.field.") ? roleField(signature.label) : undefined;
}

/**
 * Every column of the decision record a form prints a value from.
 *
 * This is what makes "optional on the record, required by the paper" a question
 * the screen can answer, rather than something discovered when a signed sheet
 * comes back from filing with a gap in it. Paragraph placeholders are not
 * counted: those already fall back to an ellipsis inside a sentence, which
 * reads as a blank to complete by hand. What is counted are the labelled slots
 * and the ruled tables, where a missing value is an empty cell under a caption
 * and reads as an answer of "none".
 */
export function sheetFields(sheet: SheetDef): string[] {
  const found = new Set<string>();
  for (const section of sheet.sections) {
    for (const block of section.blocks) {
      if (block.kind === "roster" || block.kind === "panel") {
        for (const role of block.roles) found.add(roleField(role));
      } else if (block.kind === "fields") {
        for (const row of block.rows) {
          if (row.field) found.add(row.field);
          if (row.also) found.add(row.also);
        }
      }
    }
  }
  return [...found];
}

/**
 * The columns a form would print blank for this record.
 *
 * A gap is otherwise invisible until the sheet is on paper, and a blank under
 * «استاد راهنمای دوم» does not read as "not filled in" — it reads as "there is
 * no second supervisor", and the sheet is signed and filed on that reading.
 * None of these columns can be made required on the record itself, because one
 * table carries five stages: a supervisor appointment has no thesis title and a
 * proposal has no defence date, so a rule that satisfied one form would block
 * every record belonging to another. The requirement is stated per form, which
 * is where it is actually true.
 */
export function missingFor(sheet: SheetDef, decision: Record<string, unknown>): string[] {
  return sheetFields(sheet).filter((field) => !present(decision[field]));
}

/** A value counts as present when it would print as something but a rule. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const written = String(value).trim();
  /* A bracketed slot — «[نام داور]» — is a placeholder for a name nobody
     supplied. Counting it as filled would report a form complete on the
     strength of a blank. */
  return written !== "" && !written.startsWith("[");
}
