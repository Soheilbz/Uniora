import { roleField, roleLabel, signatureField } from "@/modules/worksheets/catalogue.ts";
import type { SheetBlock, SheetSection, SignatureSpec } from "@/modules/worksheets/model.ts";
import { SheetRubric } from "./sheet-rubric";
import type { Panel, Words } from "./sheet-words.ts";

/**
 * One section of a printed form, block by block.
 *
 * Everything here draws; nothing here decides. What a column holds, which
 * person a name resolves to and how a stored value is written are all settled
 * before this file sees them, because those answers have to be the same for the
 * document, the readiness check and any later export.
 */

/**
 * What goes under a ruled column, decided by the column's own heading key.
 *
 * The tables on these forms differ in how many columns they rule and in what
 * they call them, but never in what a given column holds: «مرتبه علمی» is the
 * academic rank on every form that rules it, and «امضا» is always a line to
 * ink. Reading the kind off the key lets each form declare its own headings —
 * which is what the paper does — without a renderer that knows about forms.
 */
type PanelCell = "index" | "role" | "name" | "rank" | "affiliation" | "field" | "blank";

const PANEL_CELL: Readonly<Record<string, PanelCell>> = {
  "sheet.panel.index": "index",
  "sheet.panel.seat": "role",
  "sheet.panel.seatShort": "role",
  "sheet.panel.boardMembers": "role",
  "sheet.panel.role": "role",
  "sheet.panel.name": "name",
  "sheet.panel.rank": "rank",
  "sheet.panel.university": "affiliation",
  "sheet.panel.facultyUniversity": "affiliation",
  "sheet.panel.facultyUniversityName": "affiliation",
  "sheet.panel.universityName": "affiliation",
  "sheet.panel.fieldOfStudy": "field",
};

/** Anything not named above is a rule the sitting completes in ink. */
function cellOf(column: string): PanelCell {
  return PANEL_CELL[column] ?? "blank";
}

/**
 * The rule a blank cell draws.
 *
 * An empty `<td>` is a different statement on paper: it reads as an answer of
 * "none" on an instrument somebody signs. Every unfilled value on these forms
 * draws a dotted line to write on instead.
 */
function Rule() {
  return <span className="ws-cell-rule" />;
}

export function SheetSectionView({
  section,
  words,
  panel,
}: {
  section: SheetSection;
  words: Words;
  panel: Panel;
}) {
  return (
    <section className="ws-section">
      {section.title && (
        <h3 className="ws-section-title">
          {/* «1. » — a Latin figure, a full stop and a space, which is how every
              one of these forms numbers its sections. Persian figures with no
              space after them is a different heading. */}
          {section.number !== undefined && <span className="ws-num">{section.number}. </span>}
          {words.fill(section.title)}
        </h3>
      )}

      {section.blocks.map((block) => (
        <Block key={blockKey(block)} block={block} words={words} panel={panel} />
      ))}

      {section.signatures && (
        <Signatures signatures={section.signatures} words={words} panel={panel} />
      )}

      {section.footnote && <p className="ws-note">{words.fill(section.footnote)}</p>}
    </section>
  );
}

function Block({ block, words, panel }: { block: SheetBlock; words: Words; panel: Panel }) {
  switch (block.kind) {
    case "paragraph":
      return <p className="ws-p">{words.fill(block.text)}</p>;

    case "fields":
      return (
        <dl className="ws-fields">
          {block.rows.map((row) => (
            <div
              key={`${row.label}-${row.field ?? ""}`}
              className={row.wide ? "ws-field ws-field-wide" : "ws-field"}
            >
              {row.label !== "" && <dt>{words.t(row.label)}:</dt>}
              {/* Both columns on one line where the caption asks two things —
                  «روز و تاریخ برگزاری» wants the weekday *and* the date. */}
              <dd>
                {row.field
                  ? `${row.prefix ? `${words.t(row.prefix)} ` : ""}${[row.field, row.also]
                      .filter((field): field is string => field !== undefined)
                      .map(words.display)
                      .join(" - ")}`
                  : ""}
              </dd>
            </div>
          ))}
        </dl>
      );

    /*
     * One outcome to a line, which is how the paper rules them.
     *
     * A row saves vertical space and costs the sheet its meaning: «موافقت
     * گردید.» runs straight into «موافقت نگردید.» with a tick-box between, and
     * on the evaluation form three verdicts — one a full sentence with a
     * deadline inside it — arrive as a single paragraph of alternatives. Which
     * box is ticked is the entire content of these sections.
     */
    case "choices":
      return (
        <div className="ws-choices">
          {block.label && <span className="ws-choices-label">{words.t(block.label)}:</span>}
          {block.options.map((option) => (
            <div key={option} className="ws-choice">
              {/* An empty box to tick in ink — nothing here is pre-decided. */}
              <span aria-hidden className="ws-box" />
              <span>{words.fill(option)}</span>
            </div>
          ))}
        </div>
      );

    case "declarations":
      return (
        <ol className="ws-decl">
          {block.items.map((item, index) => (
            <li key={item}>
              <span className="ws-num">{words.figures(index + 1)}.</span>
              <span>{words.fill(item)}</span>
            </li>
          ))}
        </ol>
      );

    case "panel":
      return (
        <table className="ws-table">
          <thead>
            <tr>
              {block.columns.map((column) => (
                <th scope="col" key={column}>
                  {words.t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.roles.map((role, index) => {
              const held = panel(words.display(roleField(role)));
              return (
                <tr key={`${roleLabel(role)}-${roleField(role)}`}>
                  {block.columns.map((column) => (
                    <td key={column}>
                      <PanelValue
                        cell={cellOf(column)}
                        held={held}
                        index={index + 1}
                        role={words.t(roleLabel(role))}
                        field={words.display("field_of_study")}
                        words={words}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      );

    /*
     * The bound minute lists who attended rather than ruling a table for them.
     * It is bound into the thesis and reads as a letter: a paragraph, the
     * grade, and the panel written out in sentences.
     */
    case "roster":
      return (
        <div className="ws-roster">
          <h4 className="ws-roster-title">{words.t(block.title)}:</h4>
          <ol>
            {block.roles.map((role, index) => {
              const held = panel(words.display(roleField(role)));
              /* «دکتر عبداله جمشیدی، دانشیار، دانشکده دامپزشکی» — with no ruled
                 table to carry them, the rank and the faculty go in the
                 sentence, or the sheet bound into the thesis identifies the
                 panel less fully than the form it was taken from. */
              const written = words.join(
                [held.name, held.rank, held.affiliation].filter((part) => part !== ""),
              );
              return (
                <li key={`${roleLabel(role)}-${roleField(role)}`}>
                  <span className="ws-num">{words.figures(index + 1)}- </span>
                  {words.t(roleLabel(role))}: {written === "" ? "…" : written}
                </li>
              );
            })}
          </ol>
        </div>
      );

    case "grade":
      return (
        <p className="ws-grade">
          {words.fill(block.label)}: <span className="ws-grade-rule" />
        </p>
      );

    case "rubric":
      return <SheetRubric block={block} words={words} />;

    /*
     * The first rule runs from the caption, not under it. The paper writes
     * «توضیحات: ______» on one line and only stacks further rules when it wants
     * a paragraph written; a caption on its own line above every rule costs a
     * line of the page for each blank on the sheet.
     */
    case "blank":
      return (
        <div className="ws-blank">
          <p className="ws-blank-row">
            <span>{words.t(block.label)}:</span>
            <span className="ws-rule">{block.field ? words.display(block.field) : ""}</span>
          </p>
          {/* Ruled lines are interchangeable, so the key names the rule. */}
          {Array.from(
            { length: (block.lines ?? 1) - 1 },
            (_, line) => `${block.label}-rule-${line}`,
          ).map((rule) => (
            <div key={rule} className="ws-blank-line" />
          ))}
        </div>
      );

    case "note":
      return <p className="ws-note">{words.fill(block.text)}</p>;
  }
}

/** One ruled cell, whichever of the seven kinds of column it sits under. */
function PanelValue({
  cell,
  held,
  index,
  role,
  field,
  words,
}: {
  cell: PanelCell;
  held: ReturnType<Panel>;
  index: number;
  role: string;
  field: string;
  words: Words;
}) {
  switch (cell) {
    case "index":
      return <span className="ws-num">{words.figures(index)}</span>;
    case "role":
      return <>{role}</>;
    case "name":
      return held.name === "" ? <Rule /> : held.name;
    case "rank":
      return held.rank === "" ? <Rule /> : held.rank;
    case "affiliation":
      return held.affiliation === "" ? <Rule /> : held.affiliation;
    case "field":
      return <>{field}</>;
    case "blank":
      return <Rule />;
  }
}

/**
 * The signature boxes at the foot of a section.
 *
 * Each names the office, prints the holder where the record knows them — the
 * paper has the research deputy's name typed on it, not a blank — and rules a
 * line to sign. Two rules, «نام:» and «امضا:», which is what the form draws;
 * `detailed` adds the rank and the faculty *filled from the register*, and only
 * on the boxes whose signatory appears in no table on the sheet.
 */
function Signatures({
  signatures,
  words,
  panel,
}: {
  signatures: SignatureSpec[];
  words: Words;
  panel: Panel;
}) {
  return (
    <div className="ws-signs">
      {signatures.map((signature) => {
        const field = signatureField(signature);
        const value = field ? words.display(field) : "";
        /* The student signs under their own name; everyone else on these forms
           is a member of faculty and carries «دکتر». `student_name` is the one
           column that is not a colleague. */
        const written = field === "student_name" ? value : panel(value).name;

        if (signature.inline) {
          return (
            <p key={signature.label} className="ws-sign-inline">
              {words.t(signature.label)}: {written === "" ? "…" : written}
            </p>
          );
        }

        return (
          <div key={signature.label} className="ws-sign">
            <p className="ws-sign-caption">{words.t(signature.label)}:</p>
            <p className="ws-sign-row">
              <span>{words.t("sheet.sign.name")}:</span>
              <span className="ws-rule">{written}</span>
            </p>
            {signature.detailed && (
              <>
                <p className="ws-sign-row">
                  <span>{words.t("sheet.panel.rank")}:</span>
                  <span className="ws-rule">{panel(value).rank}</span>
                </p>
                <p className="ws-sign-row">
                  <span>{words.t("sheet.panel.facultyThenUniversity")}:</span>
                  <span className="ws-rule">{panel(value).affiliation}</span>
                </p>
              </>
            )}
            <p className="ws-sign-row">
              <span>
                {words.t(signature.dated ? "sheet.f.dateAndSignature" : "sheet.panel.signature")}:
              </span>
              <span className="ws-rule" />
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Keys derived from what a block says rather than where it sits.
 *
 * The definitions are static, so a positional key would work today — and would
 * silently attach the wrong state to the wrong block the first time somebody
 * reorders a form.
 */
function blockKey(block: SheetBlock): string {
  switch (block.kind) {
    case "paragraph":
    case "note":
      return `${block.kind}:${block.text}`;
    case "fields":
      return `fields:${block.rows.map((row) => row.field ?? row.label).join("|")}`;
    case "choices":
      return `choices:${block.options.join("|")}`;
    case "declarations":
      return `declarations:${block.items[0] ?? ""}`;
    case "panel":
      return `panel:${block.columns.length}:${block.roles.map(roleLabel).join("|")}`;
    case "roster":
      return `roster:${block.title}`;
    case "grade":
      return `grade:${block.label}`;
    case "rubric":
      return `rubric:${block.criteria.map((criterion) => criterion.label).join("|")}`;
    case "blank":
      return `blank:${block.label}:${block.lines ?? 1}`;
  }
}

export function sheetSectionKey(section: SheetSection): string {
  return [
    section.number ?? "",
    section.title ?? "",
    section.blocks.map(blockKey).join("~"),
    section.footnote ?? "",
  ].join("/");
}
