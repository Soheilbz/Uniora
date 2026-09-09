import { describe, expect, it } from "vitest";
import { render, text } from "../../../test-support/engine-render";
import { Toolbar, ToolbarButton, ToolbarDivider, ToolbarGroup } from "./toolbar";

/**
 * The command strip's own promises, as distinct from what any one register
 * puts in it.
 *
 * ── What is here and what is not ────────────────────────────────────────────
 *
 * The roving tabindex is this component's most interesting behaviour and none
 * of it is below: it lives in an effect and in a key handler, both of which need
 * a browser and a focused element. It is checked against the running
 * application instead.
 *
 * What *is* here is everything a first render decides — the roles, the names,
 * the pressed state of a toggle — and every one of those is a promise made to a
 * screen reader. They are invisible on screen by definition, which is exactly
 * why nothing else would notice them going.
 */

describe("the strip itself", () => {
  it("announces itself as a toolbar with a name", () => {
    /*
     * `role="toolbar"` is a promise of one tab stop with arrows inside it,
     * rather than eight stops to tab past on every screen. Without the name it
     * is an unlabelled landmark — «toolbar» and nothing else.
     */
    const markup = render(<Toolbar label="نوار ابزار">{null}</Toolbar>);
    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-label="نوار ابزار"');
    expect(markup).toContain('aria-orientation="horizontal"');
  });

  it("stays off the paper", () => {
    expect(render(<Toolbar label="نوار ابزار">{null}</Toolbar>)).toContain("data-print-hide");
  });
});

describe("a group of commands", () => {
  it("is a named group, not just a line between two runs of buttons", () => {
    /*
     * A divider is a line, and a line is nothing to a screen reader beyond
     * «there is a boundary here». The name is the only part of the grouping
     * that survives having the CSS switched off.
     */
    const markup = render(
      <ToolbarGroup label="پرونده">
        <ToolbarButton>افزودن</ToolbarButton>
      </ToolbarGroup>,
    );
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="پرونده"');
    expect(text(markup)).toContain("افزودن");
  });
});

describe("a command", () => {
  it("says it is a toggle only when it is one", () => {
    /*
     * «فیلترها» is pressed or not; «افزودن دانشجو» is neither. An
     * `aria-pressed="false"` on an ordinary command tells a screen reader it is
     * a switch that is currently off, which is a different control.
     */
    expect(render(<ToolbarButton checked={false}>فیلترها</ToolbarButton>)).toContain(
      'aria-pressed="false"',
    );
    expect(render(<ToolbarButton checked>فیلترها</ToolbarButton>)).toContain('aria-pressed="true"');
    expect(render(<ToolbarButton>افزودن دانشجو</ToolbarButton>)).not.toContain("aria-pressed");
  });

  it("says it is unavailable rather than looking ordinary", () => {
    /*
     * Present and disabled, never absent. A command that materialises once a
     * row is ticked is a command nobody finds, because finding it requires
     * already having done the thing that reveals it.
     */
    const markup = render(<ToolbarButton disabled>ویرایش</ToolbarButton>);
    expect(text(markup)).toContain("ویرایش");
    expect(markup).toContain("disabled");
  });

  it("renders as whatever element the caller supplies", () => {
    /*
     * The commands that navigate are real links — so they can be
     * middle-clicked, copied, and used before the JavaScript arrives. A click
     * handler could offer none of that.
     */
    const markup = render(<ToolbarButton render={<a href="/students/new">افزودن</a>} />);
    expect(markup).toContain('href="/students/new"');
    expect(markup).not.toContain("<button");
  });
});

describe("a divider", () => {
  it("is decoration, and says so", () => {
    /* Base UI's separator carries the orientation; what matters here is that a
       line between two named groups adds nothing a reader has to listen to. */
    expect(render(<ToolbarDivider />)).toContain('data-orientation="vertical"');
  });
});
