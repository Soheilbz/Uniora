import { describe, expect, it, vi } from "vitest";
import { render, text } from "../../../test-support/engine-render";

/**
 * The register's foot.
 *
 * Three of the four claims below are about controls that must *not* disappear.
 * That is the whole design of this component and it is the kind of rule a
 * refactor undoes without anybody noticing: hiding «قبلی» on page one is the
 * obvious thing to do, it looks tidier, and the cost — the «بعدی» button moving
 * sideways between page 1 and page 2, so the thing somebody is clicking
 * repeatedly is never where they left it — only shows up in use.
 */

vi.mock("next-intl/server", async () => {
  const { words } = await import("../../../test-support/engine-render");
  return {
    getTranslations: async (namespace: string) => words(namespace),
    getLocale: async () => "fa",
  };
});

const { Pager } = await import("./pager");

const base = {
  page: 2,
  pages: 4,
  total: 40,
  shown: 10,
  size: 10,
  sizes: [10, 25, 50, 100] as const,
  sizeHrefFor: (size: number) => `?size=${size}`,
  hrefFor: (page: number) => `?page=${page}`,
};

/** An async server component is a function returning JSX; awaiting it is enough. */
const foot = async (props: Partial<typeof base> = {}) => render(await Pager({ ...base, ...props }));

describe("the register's foot", () => {
  it("says what is on screen out of what matched, in the reader's numerals", async () => {
    /* Not the count of matches alone: on the last page that leaves somebody
       unable to tell whether they are looking at three records or thirty. And
       in Persian digits, like every other figure on the page — an ASCII «37»
       beside a table of «۳۷ نفر» is the one number that was left raw. */
    const shown = text(await foot({ shown: 7, total: 37 }));
    expect(shown).toContain("۷");
    expect(shown).toContain("۳۷");
    expect(shown).not.toContain("37");
  });

  it("keeps «قبلی» on the first page, disabled rather than gone", async () => {
    const markup = await foot({ page: 1 });
    expect(text(markup)).toContain("قبلی");
    expect(markup).toContain("aria-disabled");
    /* Present but not a link — nothing to click through to. */
    expect(markup).not.toContain('href="?page=0"');
  });

  it("keeps «بعدی» on the last page, disabled rather than gone", async () => {
    const markup = await foot({ page: 4, pages: 4 });
    expect(text(markup)).toContain("بعدی");
    expect(markup).not.toContain('href="?page=5"');
  });

  it("links both ways in the middle", async () => {
    const markup = await foot({ page: 2, pages: 4 });
    expect(markup).toContain('href="?page=1"');
    expect(markup).toContain('href="?page=3"');
    /* `rel` is what tells a browser and a crawler which is which. */
    expect(markup).toContain('rel="prev"');
    expect(markup).toContain('rel="next"');
  });

  it("marks the page size in force, and links the rest", async () => {
    const markup = await foot({ size: 25 });
    expect(markup).toContain('aria-current="true"');
    /* Every other size is a real address — a view somebody can bookmark or
       send to a colleague, which a select could not offer. */
    expect(markup).toContain('href="?size=10"');
    expect(markup).toContain('href="?size=50"');
    expect(markup).not.toContain('href="?size=25"');
  });

  it("stays off the paper", async () => {
    /* A printed register carries its rows, not the means of getting to the next
       page of them. */
    expect(await foot()).toContain("data-print-hide");
  });

  it("hides nothing when there is only one page", async () => {
    /*
     * A single-page register still has a page-size chooser and a count, and the
     * two ends still say they cannot be used. A foot that disappears below one
     * page is a foot that disappears exactly when a clerk is deciding whether
     * to widen the page size.
     */
    const markup = await foot({ page: 1, pages: 1, total: 4, shown: 4 });
    expect(text(markup)).toContain("قبلی");
    expect(text(markup)).toContain("بعدی");
    expect(markup).toContain('href="?size=25"');
  });
});
