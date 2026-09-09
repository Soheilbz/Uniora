import { Fragment } from "react";
import type { RubricCriterion, SheetBlock } from "@/modules/worksheets/model.ts";
import type { Words } from "./sheet-words.ts";

/**
 * The mark sheets, in the two shapes the paper forms use.
 *
 * Apart from the rest of the renderer because a rubric is the one block whose
 * layout is decided by the marking scheme rather than by the house style: the
 * seminar marks per heading and spans one cell across the criteria under it,
 * and the final defence takes a single mark for the whole work and prints no
 * maxima at all. Both are properties of what the university awards, not of how
 * a form is set.
 */

/** The criteria of one heading, and what that heading is worth in total. */
interface RubricGroup {
  heading: string | undefined;
  criteria: RubricCriterion[];
  max: number;
}

function grouped(criteria: readonly RubricCriterion[]): RubricGroup[] {
  const groups: RubricGroup[] = [];
  for (const criterion of criteria) {
    const last = groups.at(-1);
    if (last && last.heading === criterion.group && criterion.group !== undefined) {
      last.criteria.push(criterion);
      last.max += criterion.max ?? 0;
    } else {
      groups.push({ heading: criterion.group, criteria: [criterion], max: criterion.max ?? 0 });
    }
  }
  return groups;
}

/**
 * A mark ceiling, in ASCII — «5», not «۵».
 *
 * The one column on these forms that is *not* localised, and version 1's own
 * choice. Everything else on a worksheet is Persian throughout — the student
 * number, the dates, the registration number — because it is quoting the
 * record. This column is a scoring scale the examiner writes a mark into beside
 * it, and the scale and the hand-written mark sit in the same cell.
 *
 * `print.test.ts` holds it: the masters seminar evaluation prints `1 2 5 7 20`
 * down its right-hand column in the filed copies, and localising them was the
 * single difference between this build's fourteen forms and the university's.
 */
function figures(value: number): string {
  return String(value);
}
export function SheetRubric({
  block,
  words,
}: {
  block: Extract<SheetBlock, { kind: "rubric" }>;
  words: Words;
}) {
  const groups = grouped(block.criteria);

  /*
   * No maxima: the form lists what the panel weighs and takes one mark for the
   * work, in figures and in words. Numbers against these eleven criteria would
   * state a scheme the university never printed.
   */
  if (block.total === undefined) {
    return (
      <table className="ws-table">
        <thead>
          <tr>
            <th scope="col" className="ws-col-heading">
              {words.t("sheet.fin.criteria")}
            </th>
            <th scope="col">{words.t("sheet.rubric.criterion")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.heading ?? group.criteria[0]?.label}>
              {group.criteria.map((criterion, index) => (
                <tr key={criterion.label}>
                  {index === 0 && (
                    <td rowSpan={group.criteria.length} className="ws-cell-middle">
                      {group.heading ? words.t(group.heading) : ""}
                    </td>
                  )}
                  <td>{words.fill(criterion.label)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="ws-total">
            <td className="ws-cell-centre">{words.t("sheet.rubric.finalMark")}</td>
            <td>
              <span className="ws-marks">
                {words.t("sheet.rubric.inFigures")}: <span className="ws-rule" />
                {words.t("sheet.rubric.inWords")}: <span className="ws-rule" />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  /*
   * Marked per heading: «بررسی کار دیگران» is worth five between its two
   * criteria and takes one mark, which is why the maximum and the mark are
   * single cells spanning the rows under it. A maximum against every
   * sub-criterion — three and two where the form says five — invents a scheme
   * the board is not marking to.
   */
  return (
    <table className="ws-table">
      <thead>
        <tr>
          <th scope="col" colSpan={2}>
            {words.t("sheet.rubric.criterion")}
          </th>
          <th scope="col" className="ws-col-mark">
            {words.t("sheet.rubric.max")}
          </th>
          <th scope="col" className="ws-col-mark">
            {words.t("sheet.rubric.awarded")}
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.heading ?? group.criteria[0]?.label}>
            {group.criteria.map((criterion, index) => (
              <tr key={criterion.label}>
                {group.heading === undefined ? (
                  <td colSpan={2}>{words.fill(criterion.label)}</td>
                ) : (
                  <>
                    {index === 0 && (
                      <td rowSpan={group.criteria.length} className="ws-cell-middle">
                        {words.t(group.heading)}
                      </td>
                    )}
                    <td>{words.fill(criterion.label)}</td>
                  </>
                )}
                {index === 0 && (
                  <>
                    <td rowSpan={group.criteria.length} className="ws-cell-middle ws-num">
                      {figures(group.max)}
                    </td>
                    <td rowSpan={group.criteria.length} />
                  </>
                )}
              </tr>
            ))}
          </Fragment>
        ))}
        <tr className="ws-total">
          <td colSpan={2}>{words.t("sheet.rubric.total")}</td>
          <td className="ws-cell-centre ws-num">{figures(block.total)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}
