/**
 * What a register is, in the abstract.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The student register was written first and its URL handling was written
 * against it: `FILTERS` and `SORTABLE` imported directly, `/students` as a
 * default argument. The council brings three more registers — sittings,
 * decisions, rulings — and the professors' directory brings a fourth. Copying
 * that file four times would mean four places where "reset to page 1 when a
 * filter changes" is implemented, and the way that goes wrong is that one of
 * them does not.
 *
 * So a register describes itself here, and one implementation reads the URL for
 * all of them.
 *
 * ── The constraint this file lives under ────────────────────────────────────
 *
 * No drizzle, no schema, nothing that reaches a database. The toolbar and the
 * search box are client components and import the URL builders, so anything
 * this touched would be pulled into the browser bundle — importing the table
 * definitions here would ship the whole schema to every reader.
 */

export interface FilterDef {
  /** The URL parameter, and the column the query compares. */
  key: string;
  /**
   * Which vocabulary fills its options, or `null` for a free-text column.
   *
   * `null` is not «no options» — it is «the options are whatever the register
   * actually holds». A professor's specialisation is free text on the record,
   * so there is no reference list to offer; the choices are read from the
   * column itself, which is also what keeps the list short enough to pick from.
   *
   * The comparison differs with it. A vocabulary value is compared exactly,
   * because it is a key; a free-text one is compared *folded*, because the same
   * specialisation is spelled «داخلی دام‌های بزرگ» on four records and «داخلی
   * دامهای بزرگ» on three, and an exact match would leave one of those groups
   * out of its own filter.
   */
  set: string | null;
  /**
   * The filter whose value narrows this one's options, or null.
   *
   * Spelled on every filter rather than left optional: a union whose members
   * have different shapes cannot be read with `filter.narrowedBy` at all, and
   * the alternative is a cast at every call site.
   *
   * The academic hierarchy — a faculty holds departments, a department holds
   * fields — so each list offers only what the level above actually contains.
   * Without it a clerk who picks a faculty still scrolls every department in the
   * institution, and can ask for one that faculty does not have.
   */
  narrowedBy: string | null;
}

export interface RegisterSpec {
  /** Where the register lives: `/students`, `/council-meetings`. */
  basePath: string;
  filters: readonly FilterDef[];
  /** The columns SQL can meaningfully order by. */
  sortable: readonly string[];
  defaultSort: string;
  /** Default order for the default sort. Other columns still begin ascending when first selected. */
  defaultDirection?: "asc" | "desc";
}

/**
 * Rows per page, and the sizes on offer.
 *
 * The list is closed because this number reaches `LIMIT`. Taken on trust from
 * the address bar it is a way to ask one request for the whole archive — not a
 * data leak, since row-level security still applies, but a way to hold a pooled
 * connection while PostgreSQL materialises forty thousand rows, as often as
 * somebody likes.
 */
export const PAGE_SIZE = 10;
export const PAGE_SIZES = [10, 25, 50, 100] as const;
/**
 * A defensive ceiling on an address-bar page number.
 *
 * Pagination is offset-based. Letting an arbitrary integer through means a
 * crafted `?page=9007199254740991` can make PostgreSQL walk an absurd offset
 * before returning nothing. Ten thousand pages still covers a million-row
 * register at the largest page size — far beyond this product's intended
 * office scale — while keeping one request bounded.
 */
export const MAX_PAGE = 10_000;
export type PageSize = (typeof PAGE_SIZES)[number];

export function isPageSize(value: unknown): value is PageSize {
  return typeof value === "number" && (PAGE_SIZES as readonly number[]).includes(value);
}

export interface RegisterQuery {
  search: string;
  filters: Record<string, string>;
  sort: string;
  direction: "asc" | "desc";
  /** Primary plus optional secondary/tertiary sort keys. `sort`/`direction` remain compatibility aliases for item 0. */
  sorts?: RegisterSort[];
  page: number;
  size: PageSize;
  /** Opaque server-issued keyset boundary; empty keeps legacy offset semantics. */
  cursor?: string;
}

export interface RegisterSort {
  key: string;
  direction: "asc" | "desc";
}

export function sortSequence(query: RegisterQuery): RegisterSort[] {
  return query.sorts && query.sorts.length > 0
    ? query.sorts
    : [{ key: query.sort, direction: query.direction }];
}

export interface RegisterPage<Row> {
  rows: Row[];
  /** How many the query matched, not how many are on screen. */
  total: number;
  pages: number;
  page: number;
  /** Cursor navigation is additive so legacy register implementations remain valid during migration. */
  nextCursor?: string | null;
  previousCursor?: string | null;
  cursorMode?: boolean;
}

/**
 * The vocabularies a register's filter row needs, for one `lookupTable` call.
 *
 * A free-text filter — `set: null` — contributes nothing: its choices come from
 * the column itself, not from a reference list.
 */
export function filterSets(spec: RegisterSpec): string[] {
  return [...new Set(spec.filters.map((filter) => filter.set).filter((set) => set !== null))];
}
