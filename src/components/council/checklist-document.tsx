import type { SittingMeeting, SittingPapers } from "@/modules/council/papers.ts";
import {
  CHECKLIST_PAGE_SIZE,
  type ChecklistRow,
  chunk,
  DEFENCE_ROWS,
  isNamed,
  isSupplied,
  normalizeSpacing,
  PROPOSAL_ROWS,
  type SittingDecision,
  stripApproval,
  withHonorific,
} from "@/modules/council/sittings.ts";
import { SectionTitle, Sheet, SittingDetails, type SittingLabels, sittingDate } from "./paper";

/**
 * What each case still owes, four cases to a page.
 *
 * The grid is transposed — attributes down the side, cases across the top —
 * because the office compares the same paper across the four files it is
 * holding, not the whole of one file at a time. Short pages are padded to four
 * columns so every sheet is the same width and the stack squares up.
 *
 * This is the sheet the council reads *before* it votes, which is why the
 * resolutions in section (ج) have their verb of approval stripped: printed as
 * stored, they would state the outcome of a decision the council has not taken.
 */

export interface ChecklistWords {
  heading: string;
  attribute: string;
  sectionA: string;
  sectionB: string;
  sectionC: string;
  sectionCEmpty: string;
  letters: { a: string; b: string; c: string };
  doctor: string;
  details: SittingLabels;
  /** The row labels, already resolved from `decisions.*`. */
  label: (key: string) => string;
  /** A vocabulary value in its own words. */
  lookup: (set: string, value: string | null) => string;
}

/**
 * The checklist's heading, and only it.
 *
 * No letterhead above it. Version 1 heads this sheet «چک‌لیست شورای پژوهشی و
 * تحصیلات تکمیلی دانشکده» and nothing else, so a line of institution name over
 * the top would be a different document from the one the office has filed.
 * The minute is the paper that names the faculty, and it does so *inside* its
 * own heading rather than above it.
 */
function ChecklistHeading({ title }: { title: string }) {
  return (
    <header className="break-after-avoid border-b-2 border-black/70 pb-2 text-center">
      <h1 className="font-bold">{title}</h1>
    </header>
  );
}

export function ChecklistDocument({
  papers,
  words,
}: {
  papers: SittingPapers;
  words: ChecklistWords;
}) {
  const { meeting, sections, rulings, notes } = papers;

  return (
    <>
      {chunk(sections.proposals, CHECKLIST_PAGE_SIZE).map((page) => (
        <ChecklistSheet
          key={`a-${page[0]?.id ?? ""}`}
          meeting={meeting}
          letter={words.letters.a}
          title={words.sectionA}
          rows={PROPOSAL_ROWS}
          page={page}
          words={words}
        />
      ))}

      {chunk(sections.defences, CHECKLIST_PAGE_SIZE).map((page) => (
        <ChecklistSheet
          key={`b-${page[0]?.id ?? ""}`}
          meeting={meeting}
          letter={words.letters.b}
          title={words.sectionB}
          rows={DEFENCE_ROWS}
          page={page}
          words={words}
        />
      ))}

      {/*
       * Section (ج) is one numbered list running through the rulings and then
       * the council's own notes, so the sitting's miscellany is a single agenda
       * rather than two. The numbering runs through both because on the paper
       * the notes are further items of «سایر موارد», not a second list.
       */}
      <Sheet>
        <ChecklistHeading title={words.heading} />
        <div className="mt-3">
          <SittingDetails meeting={meeting} paper="checklist" labels={words.details} />
        </div>
        <div className="mt-3">
          <SectionTitle bare letter={words.letters.c} title={words.sectionC} />
        </div>

        {rulings.length === 0 && notes.length === 0 ? (
          <p className="py-6 text-center text-sm italic text-black/50">{words.sectionCEmpty}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2">
            {rulings.map((ruling, index) => (
              <li
                key={ruling.id}
                className="break-inside-avoid rounded-sm border-s-4 border-black/25 bg-black/[0.03] p-3 text-justify text-sm leading-7"
              >
                <span className="font-medium">{index + 1})</span>
                {stripApproval(normalizeSpacing(ruling.decisionText ?? ""))}
                {ruling.decisionDescription?.trim() && (
                  <p className="mt-1.5 text-xs text-black/60">
                    {ruling.decisionDescription.trim()}
                  </p>
                )}
              </li>
            ))}
            {notes.map((note, index) => (
              <li
                key={note}
                className="break-inside-avoid rounded-sm border-s-4 border-black/25 bg-black/[0.03] p-3 text-justify text-sm leading-7"
              >
                <span className="font-medium">{rulings.length + index + 1})</span>
                {note}
              </li>
            ))}
          </ol>
        )}
      </Sheet>
    </>
  );
}

function ChecklistSheet({
  meeting,
  letter,
  title,
  rows,
  page,
  words,
}: {
  meeting: SittingMeeting;
  letter: string;
  title: string;
  rows: readonly ChecklistRow[];
  page: SittingDecision[];
  words: ChecklistWords;
}) {
  /* Short pages padded to four columns, so every sheet is the same width. */
  const padding = Array.from(
    { length: Math.max(0, CHECKLIST_PAGE_SIZE - page.length) },
    (_, index) => `pad-${index}`,
  );

  const cell = (row: ChecklistRow, decision: SittingDecision): string => {
    if (row.kind === "placement") {
      const degree = words.lookup("degrees", decision.educationLevel);
      const field = words.lookup("fields_of_study", decision.fieldOfStudy);
      return [degree, field].filter(Boolean).join(" - ");
    }

    const value = row.key ? decision[row.key] : null;

    if (row.kind === "tick") return isSupplied(value) ? "☑" : "";
    if (row.kind === "person") {
      return isNamed(value) ? withHonorific(String(value), words.doctor) : "";
    }
    if (row.kind === "date") return sittingDate(value === null ? null : String(value));
    /*
     * As stored, digits and all. The filed copies carry «4002612042» — a
     * student number is quoted from the register, not a figure the document
     * composes, and the office matches it against paperwork that spells it the
     * same way.
     */
    return value === null || value === undefined ? "" : String(value);
  };

  return (
    <Sheet>
      <ChecklistHeading title={words.heading} />
      <div className="mt-3">
        <SittingDetails meeting={meeting} paper="checklist" labels={words.details} />
      </div>
      <div className="mt-3">
        <SectionTitle bare letter={letter} title={title} />
      </div>

      {/* The table scrolls inside its own box on a narrow screen; on paper it
          is already the width of the sheet. */}
      <div className="mt-2 overflow-x-auto">
        <table className="council-checklist-table w-full table-fixed border border-black/40 text-[11px]">
          <colgroup>
            <col className="w-1/5" />
            <col className="w-1/5" />
            <col className="w-1/5" />
            <col className="w-1/5" />
            <col className="w-1/5" />
          </colgroup>
          <thead>
            <tr className="bg-black/[0.06]">
              <th
                scope="col"
                className="w-1/5 border border-black/40 px-1.5 py-1 text-start font-medium"
              >
                {words.attribute}
              </th>
              {page.map((decision) => (
                <th
                  scope="col"
                  key={decision.id}
                  className="border border-black/40 px-1.5 py-1 text-start font-medium"
                >
                  {decision.studentName}
                </th>
              ))}
              {padding.map((key) => (
                <th scope="col" key={key} className="border border-black/40 px-1.5 py-1" />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.label}-${row.key ?? row.kind}`}>
                <th
                  scope="row"
                  className="border border-black/40 bg-black/[0.04] px-1.5 py-1 text-start font-medium"
                >
                  {words.label(row.label)}
                </th>
                {page.map((decision) => (
                  <td
                    key={decision.id}
                    className={
                      row.kind === "tick"
                        ? "border border-black/40 px-1.5 py-1 text-center"
                        : "border border-black/40 px-1.5 py-1"
                    }
                  >
                    {cell(row, decision)}
                  </td>
                ))}
                {padding.map((key) => (
                  <td key={key} className="border border-black/40 px-1.5 py-1" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}
