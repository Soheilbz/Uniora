import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { bodyRows, headers, render, text, words } from "../../../test-support/engine-render";

/**
 * The register engine's contract with every screen built on it.
 *
 * ── Why this layer, and why it had none ─────────────────────────────────────
 *
 * Twelve screens render through `RegisterView`, and until this file none of them
 * had a test between the SQL underneath and the browser above. The suite covered
 * domain rules, queries, URL parsing, capabilities, wording and the printed
 * documents — everything except the component that decides which columns appear,
 * in what order, drawn how, with which commands over them.
 *
 * That is exactly the layer where a dropped column lives. A register that loses
 * «داوران» still renders, still pages, still sorts, still passes every other test
 * in this repository, and looks entirely correct to anybody who does not already
 * know the column should be there.
 */

/*
 * The two modules that need a request behind them, and nothing else.
 *
 * `vi.mock` is hoisted above every import in this file, so a factory cannot
 * close over anything declared here. An async factory can `await import` what
 * it needs, which is why the catalogue is reached that way rather than through
 * the binding at the top of the file.
 */
vi.mock("next-intl", async () => {
  const { words: catalogue } = await import("../../../test-support/engine-render");
  return { useTranslations: (namespace: string) => catalogue(namespace), useLocale: () => "fa" };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/students",
}));

const { RegisterView } = await import("./register-view");

const noop = async (): Promise<ActionResult> => ({ ok: true });

const COLUMNS = [
  { key: "number", header: "شماره" },
  { key: "name", header: "نام" },
  { key: "degree", header: "مقطع" },
  { key: "panel", header: "هیئت" },
];

const base = {
  columns: COLUMNS,
  filters: [],
  filtersShown: false,
  toggleFiltersHref: "?f=1",
  clearHref: "/students",
  narrowed: false,
  matched: 2,
  registerSize: 2,
  unit: "نفر",
  canManage: true,
  canExport: true,
  exportHref: "/students/export",
  addHref: "/students/new",
  addLabel: "افزودن دانشجو",
  /* Spelled out so a test may override it: `Partial<typeof base>` only offers
     the keys `base` actually has, and a register without a report is the
     default rather than a missing case. */
  reportsHref: undefined as string | undefined,
  deleteAction: noop,
  searchSlot: null,
  emptySlot: <p>هیچ رکوردی نیست</p>,
  footerSlot: <p data-testid="foot">صفحه ۱</p>,
};

const row = (id: string, cells: Record<string, unknown>) => ({
  id,
  href: `/students/${id}`,
  editHref: `/students/${id}/edit`,
  cells: cells as never,
});

describe("the columns a register declares", () => {
  it("draws them in the declared order, and no others", () => {
    const markup = render(
      <RegisterView
        {...base}
        rows={[row("1", { number: { text: "۴۰۰۱" }, name: { text: "مریم رضایی" } })]}
      />,
    );

    /* The tick column remains visual-only; the edit column now has a
       screen-reader-only heading so the table has a complete header model. */
    expect(headers(markup).filter(Boolean)).toEqual(["شماره", "نام", "مقطع", "هیئت", "عملیات"]);
  });

  it("draws a dash for a column this row has no cell for", () => {
    /*
     * A register declares its columns once and builds cells per row, so a row
     * missing a key is a real state — a decision with no student attached. The
     * cell says «not recorded» rather than collapsing, which would put the next
     * column's value under the wrong heading.
     */
    const markup = render(
      <RegisterView {...base} rows={[row("1", { number: { text: "۴۰۰۱" } })]} />,
    );
    const cells = [...(bodyRows(markup)[0]?.matchAll(/—/g) ?? [])];
    expect(cells.length).toBe(3);
  });
});

describe("how a cell decides what to draw", () => {
  /*
   * The precedence chain, which is the part of this component that is really a
   * decision table: a cell may carry a name panel, stacked badges, a state
   * chip, a vocabulary chip, a gender mark or plain text, and it draws exactly
   * one of them. Every entry below is a shape some register actually produces.
   */
  const only = (cells: Record<string, unknown>) =>
    text(
      render(
        <RegisterView
          {...base}
          columns={[{ key: "cell", header: "ستون" }]}
          rows={[row("1", cells)]}
        />,
      ),
    );

  it("prefers a name panel over everything else in the cell", () => {
    const shown = only({
      cell: { text: "این نباید دیده شود", list: ["علی مصباح", "حسین کاظمی"] },
    });
    expect(shown).toContain("علی مصباح");
    expect(shown).toContain("حسین کاظمی");
    expect(shown).not.toContain("این نباید دیده شود");
  });

  it("names the one member of a panel who holds a different office", () => {
    const shown = only({
      cell: {
        list: ["علی مصباح"],
        distinct: { name: "زهرا کریمی", label: "نماینده تحصیلات تکمیلی" },
      },
    });
    expect(shown).toContain("زهرا کریمی");
    /* Said in words as well as marked: colour alone is invisible in greyscale,
       and this cell prints. */
    expect(shown).toContain("نماینده تحصیلات تکمیلی");
  });

  it("drops the empty seats from a panel rather than drawing blank lines", () => {
    const shown = only({ cell: { list: ["علی مصباح", null, "", "  "] } });
    expect(shown).toContain("علی مصباح");
    expect(shown).not.toMatch(/علی مصباح\s+—/);
  });

  it("prefers stacked badges over the cell's own text", () => {
    const shown = only({
      cell: {
        text: "این نباید دیده شود",
        badges: [
          { text: "۴ حاضر", tone: "present", caption: "سعید نظیفی، فاطمه حسینی" },
          { text: "۱ غایب", tone: "absent", caption: "نماینده آموزش" },
        ],
      },
    });
    expect(shown).toContain("۴ حاضر");
    expect(shown).toContain("۱ غایب");
    expect(shown).toContain("سعید نظیفی، فاطمه حسینی");
    expect(shown).not.toContain("این نباید دیده شود");
  });

  it("draws a state chip when there is text to put in it", () => {
    const markup = render(
      <RegisterView
        {...base}
        columns={[{ key: "cell", header: "ستون" }]}
        rows={[row("1", { cell: { text: "۳ مورد", statusTone: "info" } })]}
      />,
    );
    expect(text(markup)).toContain("۳ مورد");
  });

  it("falls through to plain text when a tone has nothing to colour", () => {
    /*
     * `tone` without `text` is a decision filed under a vocabulary value that
     * resolves to nothing. The chain requires both, so the cell falls to its
     * last branch and says «not recorded» rather than drawing an empty chip.
     */
    expect(only({ cell: { text: null, tone: 2 } })).toContain("—");
  });

  it("gives the gender mark a name a screen reader can announce", () => {
    /*
     * The word is the icon's accessible name, not a fourth word in a column of
     * names — which is the whole reason it is a glyph. So the assertion is
     * against the markup: `text()` strips attributes, and a mark with no
     * `aria-label` would pass a text-only check while being a colour-and-shape
     * fact for sighted readers only.
     */
    const markup = render(
      <RegisterView
        {...base}
        columns={[{ key: "cell", header: "ستون" }]}
        rows={[
          row("1", { cell: { text: "مریم رضایی", gender: { value: "female", label: "زن" } } }),
        ]}
      />,
    );
    expect(text(markup)).toContain("مریم رضایی");
    expect(markup).toContain('aria-label="زن"');
  });

  it("draws a neutral figure, unnamed, where no gender is recorded", () => {
    /*
     * Not a blank — a column that sometimes has an icon for no reason reads as
     * broken rather than as a fact nobody supplied — and `aria-hidden` rather
     * than a name, because there is nothing to announce.
     */
    const markup = render(
      <RegisterView
        {...base}
        columns={[{ key: "cell", header: "ستون" }]}
        rows={[row("1", { cell: { text: "کاربر", gender: { value: null, label: null } } })]}
      />,
    );
    expect(text(markup)).toContain("کاربر");
    expect(markup).toContain("aria-hidden");
    expect(markup).not.toMatch(/aria-label="(زن|مرد)"/);
  });

  it("shows the quiet second line under the first", () => {
    const shown = only({ cell: { text: "۴۰۰۱۲۳۴۵", secondary: "۰۰۸۴۵۷۵۹۴۸" } });
    expect(shown).toContain("۴۰۰۱۲۳۴۵");
    expect(shown).toContain("۰۰۸۴۵۷۵۹۴۸");
  });
});

describe("the command strip", () => {
  const strip = (props: Partial<typeof base> = {}) =>
    text(
      render(<RegisterView {...base} {...props} rows={[row("1", { number: { text: "۱" } })]} />),
    );

  it("offers the register's own word for adding, not a generic one", () => {
    /* «ثبت جلسه», «افزودن دانشجو», «ثبت کارگاه» — each register names its own
       act, because «افزودن» alone in a council screen reads as adding what. */
    expect(strip({ addLabel: "ثبت جلسه" })).toContain("ثبت جلسه");
  });

  it("withholds every writing command from a viewer who may not manage", () => {
    const shown = strip({ canManage: false });
    expect(shown).not.toContain("افزودن دانشجو");
    expect(shown).not.toContain(words("common")("edit"));
  });

  it("keeps the reading commands for a viewer who may not manage", () => {
    /* A register nobody may write is still a register: filters, columns and the
       export are all reading. */
    const shown = strip({ canManage: false });
    expect(shown).toContain(words("actions")("filters"));
  });

  it("omits the export where the viewer may not have one", () => {
    expect(strip({ canExport: false })).not.toContain(words("actions")("export"));
    expect(strip({ canExport: true })).toContain(words("actions")("export"));
  });

  it("omits the reports command where a register has no report", () => {
    /* Looked up by the path the component itself uses. `reports.action` holds
       the same words today, and a test that reached the right string by the
       wrong key would keep passing after the component's key changed. */
    expect(strip({})).not.toContain(words("actions")("reports"));
    expect(strip({ reportsHref: "/students/reports" })).toContain(words("actions")("reports"));
  });

  it("files its commands in three named groups, in a fixed order", () => {
    /*
     * The contract the register holds to, and the first thing a
     * rewrite drops: a command belongs to a *kind* — record, view, report — and
     * the kinds appear in that order on every screen. Lose it and roughly nine
     * buttons per register reshuffle, so the office's muscle memory is wrong
     * everywhere at once.
     */
    const markup = render(<RegisterView {...base} rows={[row("1", { number: { text: "۱" } })]} />);
    const groups = [...markup.matchAll(/role="group" aria-label="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(groups).toEqual([
      words("actions")("group.record"),
      words("actions")("group.view"),
      words("actions")("group.report"),
    ]);
  });

  it("drops the record group entirely for a viewer who may not write", () => {
    /*
     * Dropped, not emptied — and its divider with it. `/professor-capacity` and
     * `/reviewer-counts` have no record group at all for the same reason:
     * nothing on those screens writes. A named group with nothing in it is a
     * boundary a screen reader announces around no commands.
     */
    const markup = render(
      <RegisterView {...base} canManage={false} rows={[row("1", { number: { text: "۱" } })]} />,
    );
    const groups = [...markup.matchAll(/role="group" aria-label="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(groups).toEqual([words("actions")("group.view"), words("actions")("group.report")]);
    /* One divider left, between the two groups that remain. */
    expect([...markup.matchAll(/data-orientation="vertical"/g)]).toHaveLength(1);
  });

  it("does not offer bulk delete or delete all buttons", () => {
    expect(strip({})).not.toContain(words("actions")("deleteAll"));
    expect(strip({})).not.toContain(words("actions")("bulkDelete"));
  });

  it("keeps the strip off the paper", () => {
    /* A printed register carries its rows, not the means of acting on them. */
    expect(render(<RegisterView {...base} rows={[]} />)).toContain("data-print-hide");
  });
});

describe("what a register with nothing in it says", () => {
  it("shows the empty slot rather than an empty table", () => {
    const markup = render(<RegisterView {...base} rows={[]} matched={0} registerSize={0} />);
    expect(text(markup)).toContain("هیچ رکوردی نیست");
    expect(headers(markup).filter(Boolean)).toEqual([]);
  });

  it("keeps the foot off an empty register", () => {
    /* A pager under nothing is a pager saying «صفحه ۱ از ۱» about no rows. */
    expect(text(render(<RegisterView {...base} rows={[]} matched={0} />))).not.toContain("صفحه ۱");
  });
});
