import { describe, expect, it } from "vitest";
import {
  allSelected,
  singleSelection,
  toggleColumn,
  togglePage,
  toggleRow,
  visibleColumns,
} from "./table-state.ts";

/**
 * What a register remembers, and how a click changes it.
 *
 * Every case here is one a static render cannot reach: the picker's contents
 * mount only when the menu opens, and a selection exists only after somebody has
 * clicked. `register-view.test.tsx` covers what the first render puts on the
 * page; these are the rest, and between them the engine's decisions are covered
 * without a browser.
 */

const set = (...ids: string[]) => new Set(ids);

const COLUMNS = [
  { key: "number" },
  { key: "name", locked: true },
  { key: "degree" },
  { key: "panel" },
];

describe("which columns are drawn", () => {
  it("keeps the register's own order", () => {
    /* Not the order of the hidden set, and not alphabetical: a register
       declares its columns in the order the office reads them. */
    expect(visibleColumns(COLUMNS, set()).map((one) => one.key)).toEqual([
      "number",
      "name",
      "degree",
      "panel",
    ]);
  });

  it("drops what the picker hid", () => {
    expect(visibleColumns(COLUMNS, set("degree", "panel")).map((one) => one.key)).toEqual([
      "number",
      "name",
    ]);
  });

  it("keeps a locked column even when the hidden set names it", () => {
    /*
     * The case this guards is not somebody unticking the name — the picker will
     * not let them. It is a register *gaining* a locked column while a hidden
     * set from before still names it: the table would draw with no identity in
     * it and nothing on screen would explain why.
     */
    expect(visibleColumns(COLUMNS, set("name")).map((one) => one.key)).toContain("name");
  });

  it("never hides everything", () => {
    expect(visibleColumns(COLUMNS, set("number", "name", "degree", "panel"))).toHaveLength(1);
  });
});

describe("ticking a column in the picker", () => {
  it("hides one and shows it again", () => {
    const hidden = toggleColumn(set(), { key: "degree" }, false);
    expect([...hidden]).toEqual(["degree"]);
    expect([...toggleColumn(hidden, { key: "degree" }, true)]).toEqual([]);
  });

  it("leaves the others alone", () => {
    expect([...toggleColumn(set("panel"), { key: "degree" }, false)].sort()).toEqual([
      "degree",
      "panel",
    ]);
  });

  it("refuses a locked column, and returns the very same set", () => {
    /* Identical by reference, not merely equal: a new Set would schedule a
       render for a change that did not happen. */
    const hidden = set("degree");
    expect(toggleColumn(hidden, { key: "name", locked: true }, false)).toBe(hidden);
  });
});

describe("ticking a row", () => {
  it("selects and deselects the same row", () => {
    const one = toggleRow(set(), "a");
    expect([...one]).toEqual(["a"]);
    expect([...toggleRow(one, "a")]).toEqual([]);
  });

  it("does not disturb the rest of the selection", () => {
    expect([...toggleRow(set("a", "b"), "c")].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("the header's tick box", () => {
  it("adds this page when some of it is unticked", () => {
    expect([...togglePage(set("a"), ["a", "b", "c"])].sort()).toEqual(["a", "b", "c"]);
  });

  it("clears this page when all of it is ticked", () => {
    expect([...togglePage(set("a", "b"), ["a", "b"])]).toEqual([]);
  });

  it("leaves rows selected on another page alone", () => {
    /*
     * The header ticks *this page*, which is what it can see. Somebody who ticks
     * four on page one, pages forward and ticks two more means six — and
     * dropping the first four would delete the wrong records.
     */
    expect([...togglePage(set("elsewhere"), ["a", "b"])].sort()).toEqual(["a", "b", "elsewhere"]);
    expect([...togglePage(set("elsewhere", "a", "b"), ["a", "b"])]).toEqual(["elsewhere"]);
  });

  it("is unticked over an empty page", () => {
    /* "All selected" over no rows is a claim about nothing, and clicking it
       would do nothing while looking as though it had. */
    expect(allSelected(set(), [])).toBe(false);
    expect(allSelected(set("elsewhere"), [])).toBe(false);
  });

  it("is ticked only when every row on the page is", () => {
    expect(allSelected(set("a"), ["a", "b"])).toBe(false);
    expect(allSelected(set("a", "b"), ["a", "b"])).toBe(true);
    expect(allSelected(set("a", "b", "elsewhere"), ["a", "b"])).toBe(true);
  });
});

describe("what «ویرایش» opens", () => {
  it("answers only when exactly one row is ticked", () => {
    /* None: nothing to open. Three: no answer to which — and guessing at the
       first is how somebody edits a record they did not mean to. */
    expect(singleSelection(set())).toBeUndefined();
    expect(singleSelection(set("a"))).toBe("a");
    expect(singleSelection(set("a", "b"))).toBeUndefined();
  });
});
