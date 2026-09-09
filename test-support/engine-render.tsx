import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fa from "@/messages/fa.json" with { type: "json" };

/**
 * Rendering a client component to a string, in Node, with no DOM.
 *
 * ── Why this rather than a testing library ──────────────────────────────────
 *
 * This suite runs in Node on purpose — `vitest.config.ts` says why — and the
 * questions these components raise do not need a browser to answer. «Are the
 * columns in the order the register declared them», «does a cell with badges
 * draw badges rather than its text», «is the bulk-delete command absent when
 * nothing is ticked»: every one of those is answerable from the markup. The
 * ones that genuinely need a browser — is the sidebar on the right under RTL,
 * did the font resolve — are checked against the running application, and a
 * jsdom would answer both of those wrongly while looking like it had answered.
 *
 * `renderToStaticMarkup` gives the *first* render. That is the whole surface
 * for these tests, and it is also the honest limit of them: what happens after
 * a click is not here. Where a component's behaviour turns on interaction, the
 * rule it follows is extracted into a plain function and tested as one —
 * `leaving.ts` and `selection.ts` are both that.
 *
 * ── What is faked, and why each ─────────────────────────────────────────────
 *
 * Only the three modules that need a request behind them. Nothing about the
 * components themselves is stubbed: the real `Toolbar`, the real Base UI
 * primitives and the real class names are what these render.
 */

/** The catalogue, as a translator resolves it: `t("edit")` inside «common». */
export function words(
  namespace: string,
): (key: string, values?: Record<string, unknown>) => string {
  const root: unknown = fa;
  return (key, values) => {
    let node: unknown = root;
    for (const part of `${namespace}.${key}`.split(".")) {
      if (typeof node !== "object" || node === null) return `${namespace}.${key}`;
      node = Reflect.get(node, part);
    }
    if (typeof node !== "string") return `${namespace}.${key}`;
    if (!values) return node;

    /*
     * ICU placeholders, filled far enough to be honest about the output.
     *
     * `{count, number}` is not decoration in this catalogue: under `fa` it is
     * what turns 37 into «۳۷», and every figure the office reads on screen goes
     * through it. A harness that substituted the ASCII digits would let a test
     * assert «37 است» about a page that says «۳۷ است» — passing while
     * describing something the reader never sees.
     *
     * Only the numeric case is implemented, because that is the only formatting
     * this catalogue asks for. A full ICU implementation here would be a second
     * one to keep in step with the first.
     */
    return node.replace(/\{(\w+)(?:,\s*(\w+)[^}]*)?\}/g, (whole, name, kind) => {
      if (!(name in values)) return whole;
      const value = values[name];
      return kind === "number" && typeof value === "number"
        ? new Intl.NumberFormat("fa").format(value)
        : String(value);
    });
  };
}

/** The markup a component produces, as one string. */
export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/**
 * The visible text, with the tags taken out and the whitespace collapsed.
 *
 * Assertions read better against this than against markup: «the strip offers
 * افزودن دانشجو» is the claim, and which element carries it is exactly the sort
 * of detail a test should not pin down.
 */
export function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `<th>` in document order, as text — the register's column headers. */
export function headers(markup: string): string[] {
  return [...markup.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((match) => text(match[1] ?? ""));
}

/** Every `<tr>` inside `<tbody>`, as text. */
export function bodyRows(markup: string): string[] {
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(markup)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((match) => text(match[1] ?? ""));
}
