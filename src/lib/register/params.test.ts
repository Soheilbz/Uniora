import { describe, expect, it } from "vitest";
import { queryHref, readQuery, singleParam } from "./params.ts";
import { PAGE_SIZE, type RegisterSpec } from "./spec.ts";

/**
 * What the address bar is allowed to tell a register.
 *
 * ── Why this matters more than most of the suite ────────────────────────────
 *
 * `readQuery` is the boundary between a URL anybody can type and SQL. `sort` in
 * particular *selects a column*: taken on trust it is a way to have the
 * application order by whatever the caller wrote. The membership test against
 * the register's own `sortable` tuple is the whole of what stands between those
 * two things, and until this file it had no test of any kind.
 *
 * Everything else here is about not being brittle in the other direction. A
 * person editing a URL by hand is not an attack to report; it is a page to
 * render, so every invalid value falls back rather than raising.
 */

const SPEC: RegisterSpec = {
  basePath: "/students",
  filters: [
    { key: "degree", set: "degrees", narrowedBy: null },
    { key: "status", set: "student_statuses", narrowedBy: null },
  ],
  sortable: ["name", "studentNumber", "degree"],
  defaultSort: "name",
};

/**
 * A parameter somebody repeated in the address bar.
 *
 * `?q=a&q=b` is a legal URL and Next hands it over as an array. Passed straight
 * into a query that expects a string it becomes «a,b» — a search that matches
 * nothing, or, on a filter, a value compared against a column. Neither raises:
 * the screen renders, empty, and looks like a filter that found nothing.
 */
describe("singleParam", () => {
  it("reads an ordinary value", () => {
    expect(singleParam("رضایی")).toBe("رضایی");
  });

  it("takes the first of a repeated one rather than joining them", () => {
    /* `String(["a","b"])` is «a,b», which is the failure this exists to
       prevent — and it is a failure that looks like an empty result. */
    expect(singleParam(["a", "b"])).toBe("a");
  });

  it("reads an absent parameter as an empty string", () => {
    /* Not `undefined`: every caller compares it against `""` to mean «nothing
       asked for», and one that had to handle both would eventually handle one. */
    expect(singleParam(undefined)).toBe("");
  });

  it("reads an empty repetition as an empty string", () => {
    /* `?q=` produces an empty array in some parsers; the first of nothing is
       nothing, and that is «not asked for» rather than a crash. */
    expect(singleParam([])).toBe("");
  });

  it("keeps an empty value empty rather than turning it into something", () => {
    expect(singleParam("")).toBe("");
  });
});

describe("the sort a register will accept", () => {
  it("takes a column the register declared sortable", () => {
    expect(readQuery(SPEC, { sort: "studentNumber" }).sort).toBe("studentNumber");
  });

  it("refuses a column it did not, and falls back to its own default", () => {
    /*
     * The one that matters. `sort` reaches an ORDER BY, so anything not on the
     * register's own list has to be discarded rather than passed along — and
     * discarded quietly, because the reader gets a working page either way.
     */
    expect(readQuery(SPEC, { sort: "nationalId" }).sort).toBe("name");
    expect(readQuery(SPEC, { sort: "1; drop table students" }).sort).toBe("name");
    expect(readQuery(SPEC, { sort: "" }).sort).toBe("name");
  });

  it("takes only the two directions there are", () => {
    expect(readQuery(SPEC, { dir: "desc" }).direction).toBe("desc");
    expect(readQuery(SPEC, { dir: "asc" }).direction).toBe("asc");
    /* Anything else is ascending — the direction a register reads in. */
    expect(readQuery(SPEC, { dir: "sideways" }).direction).toBe("asc");
    expect(readQuery(SPEC, {}).direction).toBe("asc");
  });
});

describe("the page and its size", () => {
  it("reads a page number", () => {
    expect(readQuery(SPEC, { page: "4" }).page).toBe(4);
  });

  it("treats anything that is not a page as the first one", () => {
    /* Somebody editing the URL by hand is not an error to report. */
    for (const asked of ["0", "-3", "abc", "", "1.5e400"]) {
      expect(readQuery(SPEC, { page: asked }).page, `page=${asked}`).toBe(1);
    }
  });

  it("caps a syntactically valid but abusive page number", () => {
    expect(readQuery(SPEC, { page: "999999999" }).page).toBe(10_000);
    expect(readQuery(SPEC, { page: "9007199254740991" }).page).toBe(10_000);
  });

  it("takes only a size the register offers", () => {
    /*
     * This number becomes a LIMIT. Taken on trust, `?size=9999999` is a way to
     * ask one request for the whole archive — not a leak, since row-level
     * security still applies, but a way to hold a pooled connection while
     * PostgreSQL materialises forty thousand rows, as often as anybody likes.
     */
    expect(readQuery(SPEC, { size: "25" }).size).toBe(25);
    expect(readQuery(SPEC, { size: "9999999" }).size).toBe(PAGE_SIZE);
    expect(readQuery(SPEC, { size: "17" }).size).toBe(PAGE_SIZE);
    expect(readQuery(SPEC, {}).size).toBe(PAGE_SIZE);
  });
});

describe("the search box", () => {
  it("carries what was typed", () => {
    expect(readQuery(SPEC, { q: "رضایی" }).search).toBe("رضایی");
  });

  it("truncates a needle nobody typed by hand", () => {
    /* It becomes a LIKE pattern; a hundred characters is past any name. */
    expect(readQuery(SPEC, { q: "ب".repeat(500) }).search).toHaveLength(100);
  });
});

describe("the filters", () => {
  it("carries only the ones this register has", () => {
    const query = readQuery(SPEC, { degree: "phd", faculty: "engineering" });
    expect(query.filters).toEqual({ degree: "phd" });
  });

  it("treats a blank filter as no filter", () => {
    /*
     * «همه» in a select posts an empty value, and an empty string compared
     * against a column matches the records whose value is the empty string —
     * which is none of them. The register would show nothing and look broken.
     */
    expect(readQuery(SPEC, { degree: "", status: "   " }).filters).toEqual({});
  });

  it("trims what somebody pasted", () => {
    expect(readQuery(SPEC, { degree: " phd " }).filters.degree).toBe("phd");
  });
});

describe("the address a changed query produces", () => {
  const base = readQuery(SPEC, { page: "4", q: "رضایی" });

  it("returns to the first page whenever the narrowing changes", () => {
    /*
     * A clerk on page 4 who types a search matching six records would otherwise
     * land on page 4 of a two-page result — an empty table under a pager
     * insisting there are six records, which reads as the search being broken.
     */
    expect(queryHref(SPEC, base, { search: "کریمی" })).not.toContain("page=");
    expect(queryHref(SPEC, base, { sort: "degree" })).not.toContain("page=");
  });

  it("keeps the page when paging is the point", () => {
    expect(queryHref(SPEC, base, { page: 5 })).toContain("page=5");
  });

  it("leaves the default size out of the address", () => {
    /* A URL somebody sends a colleague should carry what they chose, not every
       value the register would have used anyway. */
    expect(queryHref(SPEC, readQuery(SPEC, {}), {})).not.toContain("size=");
    expect(queryHref(SPEC, readQuery(SPEC, { size: "50" }), {})).toContain("size=50");
  });

  it("survives a round trip", () => {
    /*
     * The property that makes every link on a register correct: what the screen
     * writes into an address is what the next request reads back out.
     */
    const asked = readQuery(SPEC, { q: "رضایی", degree: "phd", sort: "degree", dir: "desc" });
    const href = queryHref(SPEC, asked, { page: 3 });
    const back = readQuery(SPEC, Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(back).toEqual({ ...asked, page: 3 });
  });
});
