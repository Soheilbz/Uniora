import { MAX_SEARCH_LENGTH, parseIntegerParam } from "@/lib/input-limits.ts";
import {
  isPageSize,
  MAX_PAGE,
  PAGE_SIZE,
  type RegisterQuery,
  type RegisterSort,
  type RegisterSpec,
} from "./spec.ts";

/**
 * A register's state, held in the URL.
 *
 * Not in React state, and that is the substantive choice. A clerk who has
 * narrowed a register to «دکتری تخصصی، در حال تحصیل، صفحه ۳» and wants a
 * colleague to look at it sends the address. They can bookmark it, the back
 * button walks it, a reload does not lose it, and the server can render it
 * without shipping a filtering engine to the browser.
 *
 * It is also what makes every sort header and every pager button a real link
 * with a real href — so the register works with its JavaScript still loading.
 */

/** What each piece of state is called in the address bar. */
export const PARAM = {
  search: "q",
  sort: "sort",
  direction: "dir",
  page: "page",
  size: "size",
  cursor: "cursor",
  sorts: "sorts",
  /** Whether the filter panel is open. */
  filters: "filters",
} as const;

export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The first value, for a parameter somebody has repeated in the URL by hand.
 *
 * `?q=a&q=b` is a legal address and Next hands it over as an array. Passed
 * straight into a query that expects a string it becomes «a,b» — a search
 * nothing matches, or worse, a value compared against a column. Every screen
 * that reads its own parameters needs this, so it is here rather than
 * re-declared beside each of them: four copies of a three-line rule is four
 * chances for one of them to forget the array case.
 */
export function singleParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The same, read out of a bag of parameters by key. */
function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads the query out of the address bar, and refuses to trust any of it.
 *
 * Every field is validated against a closed list and falls back to a default,
 * because these values reach SQL. `sort` in particular selects a column: taken
 * on trust it is a way to have the application order by an expression the caller
 * wrote. The membership test against the register's own `sortable` tuple is what
 * stands between the address bar and that.
 *
 * A page number that is not a number becomes 1 rather than an error. Somebody
 * editing the URL by hand is not an attack to report; it is a page to render.
 */
export function readQuery(spec: RegisterSpec, params: SearchParams): RegisterQuery {
  const sort = one(params, PARAM.sort);
  const direction = one(params, PARAM.direction);
  const page = parseIntegerParam(one(params, PARAM.page)) ?? 1;
  const size = parseIntegerParam(one(params, PARAM.size));
  const cursor = (one(params, PARAM.cursor) ?? "").trim().slice(0, 1800);
  const parsedSorts = parseSorts(spec, one(params, PARAM.sorts));

  const filters: Record<string, string> = {};
  for (const filter of spec.filters) {
    const value = one(params, filter.key)?.trim();
    if (value) filters[filter.key] = value;
  }

  const primarySort = parsedSorts[0] ?? {
    key: sort && spec.sortable.includes(sort) ? sort : spec.defaultSort,
    direction:
      direction === "desc"
        ? ("desc" as const)
        : direction === "asc"
          ? ("asc" as const)
          : sort && sort !== spec.defaultSort
            ? ("asc" as const)
            : (spec.defaultDirection ?? "asc"),
  };
  const sorts = parsedSorts.length > 0 ? parsedSorts : [primarySort];
  return {
    // Capped, because this becomes LIKE patterns and a needle nobody typed by
    // hand is a needle worth truncating.
    search: (one(params, PARAM.search) ?? "").slice(0, MAX_SEARCH_LENGTH),
    filters,
    sort: primarySort.key,
    direction: primarySort.direction,
    sorts,
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, MAX_PAGE) : 1,
    size: size !== null && isPageSize(size) ? size : PAGE_SIZE,
    cursor,
  };
}

/**
 * The address for a modified query.
 *
 * Every change except paging resets to page 1, and that is not a detail: a clerk
 * on page 4 who types a search matching six records would otherwise land on page
 * 4 of a two-page result — an empty table under a pager insisting there are six
 * records. Callers pass `page` explicitly when paging is the point.
 */
export function queryHref(
  spec: RegisterSpec,
  current: RegisterQuery,
  change: Partial<RegisterQuery> = {},
  options: { filtersOpen?: boolean } = {},
): string {
  const cursorNavigation = Object.hasOwn(change, "cursor");
  const explicitSorts = Object.hasOwn(change, "sorts");
  const primaryChanged = Object.hasOwn(change, "sort") || Object.hasOwn(change, "direction");
  const preliminary: RegisterQuery = {
    ...current,
    ...change,
    page: change.page ?? 1,
    cursor: cursorNavigation ? (change.cursor ?? "") : "",
  };
  const next: RegisterQuery = {
    ...preliminary,
    sorts: explicitSorts
      ? (change.sorts ?? [{ key: preliminary.sort, direction: preliminary.direction }])
      : primaryChanged
        ? [{ key: preliminary.sort, direction: preliminary.direction }]
        : (current.sorts ?? [{ key: current.sort, direction: current.direction }]),
  };
  const params = new URLSearchParams();

  if (next.search) params.set(PARAM.search, next.search);
  for (const filter of spec.filters) {
    const value = next.filters[filter.key];
    if (value) params.set(filter.key, value);
  }
  // Defaults are omitted rather than spelled out, so the plain register is
  // `/students` and not `/students?sort=name&dir=asc&page=1`.
  if (next.sort !== spec.defaultSort) params.set(PARAM.sort, next.sort);
  const defaultDirection =
    next.sort === spec.defaultSort ? (spec.defaultDirection ?? "asc") : "asc";
  if (next.direction !== defaultDirection) params.set(PARAM.direction, next.direction);
  const nextSorts = next.sorts ?? [{ key: next.sort, direction: next.direction }];
  if (nextSorts.length > 1) {
    params.set(PARAM.sorts, nextSorts.map((item) => `${item.key}:${item.direction}`).join(","));
  }
  if (next.page > 1) params.set(PARAM.page, String(next.page));
  if (next.cursor) params.set(PARAM.cursor, next.cursor);
  if (next.size !== PAGE_SIZE) params.set(PARAM.size, String(next.size));
  if (options.filtersOpen) params.set(PARAM.filters, "1");

  const query = params.toString();
  return query ? `${spec.basePath}?${query}` : spec.basePath;
}

function parseSorts(spec: RegisterSpec, raw: string | undefined): RegisterSort[] {
  if (!raw) return [];
  const out: RegisterSort[] = [];
  const seen = new Set<string>();
  for (const token of raw.split(",").slice(0, 3)) {
    const [key = "", direction = "asc"] = token.split(":", 2);
    if (!spec.sortable.includes(key) || seen.has(key)) continue;
    out.push({ key, direction: direction === "desc" ? "desc" : "asc" });
    seen.add(key);
  }
  return out;
}

/**
 * The address for a change to one filter, with its dependants cleared.
 *
 * Changing the faculty has to clear the department and the field, because a
 * department belongs to a faculty: left alone, the register would ask for
 * «دانشکده‌ی دامپزشکی» *and* «گروه مهندسی کامپیوتر» and correctly return nothing,
 * which reads as a broken filter rather than as an impossible question. The
 * chain is followed transitively — faculty clears department, which clears field.
 */
export function filterHref(
  spec: RegisterSpec,
  current: RegisterQuery,
  key: string,
  value: string | null,
  options: { filtersOpen?: boolean } = {},
): string {
  const filters = { ...current.filters };
  if (value) filters[key] = value;
  else delete filters[key];

  let cleared = [key];
  while (cleared.length > 0) {
    const dependants = spec.filters
      .filter((filter) => filter.narrowedBy && cleared.includes(filter.narrowedBy))
      .map((filter) => filter.key);
    for (const dependant of dependants) delete filters[dependant];
    cleared = dependants;
  }

  return queryHref(spec, current, { filters }, options);
}

/** Keyset navigation address. The page number is presentation metadata; SQL uses only the opaque cursor. */
export function cursorHref(
  spec: RegisterSpec,
  current: RegisterQuery,
  cursor: string,
  page: number,
  options: { filtersOpen?: boolean } = {},
): string {
  return queryHref(spec, current, { cursor, page }, options);
}

/**
 * The address at a different page size, back at page one.
 *
 * Page one deliberately: somebody on page 7 of ten-row pages who switches to a
 * hundred per page is asking to see more of the register, not to be sent to row
 * 601 of it.
 */
export function pageSizeHref(
  spec: RegisterSpec,
  current: RegisterQuery,
  size: number,
  options: { filtersOpen?: boolean } = {},
): string {
  return queryHref(spec, current, { size: size as RegisterQuery["size"], page: 1 }, options);
}

/** Whether anything is narrowing the register right now. */
export function isNarrowed(query: RegisterQuery): boolean {
  return Boolean(query.search) || Object.keys(query.filters).length > 0;
}

/** Whether the filter panel should be open: asked for, or something is filtering. */
export function filtersOpen(params: SearchParams, query: RegisterQuery): boolean {
  return one(params, PARAM.filters) === "1" || isNarrowed(query);
}
