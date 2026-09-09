import { and, asc, desc, eq, gt, lt, or, type SQL } from "drizzle-orm";

export type Comparable = Parameters<typeof eq>[0];
export type KeysetValue = string | number;

/** Builds a lexicographic boundary over normalized, non-null sort expressions plus the UUID tie-breaker. */
export function keysetBoundary(
  columns: readonly Comparable[],
  values: readonly KeysetValue[],
  idColumn: Comparable,
  id: string,
  direction: "asc" | "desc",
  mode: "after" | "before",
): SQL | undefined {
  if (columns.length === 0 || columns.length !== values.length) return undefined;
  const forward = mode === "after";
  const greater = direction === "asc" ? forward : !forward;
  const compare = greater ? gt : lt;
  const disjunction: SQL[] = [];

  for (let index = 0; index < columns.length; index += 1) {
    const equals = columns
      .slice(0, index)
      .map((column, prior) => eq(column, values[prior] as KeysetValue));
    disjunction.push(
      and(...equals, compare(columns[index] as Comparable, values[index] as KeysetValue)) as SQL,
    );
  }
  const allEqual = columns.map((column, index) => eq(column, values[index] as KeysetValue));
  disjunction.push(and(...allEqual, compare(idColumn, id)) as SQL);
  return or(...disjunction);
}

/** Reverse physical order when walking backwards, then reverse rows in memory for display. */
export function keysetOrder(
  columns: readonly Comparable[],
  idColumn: Comparable,
  direction: "asc" | "desc",
  mode: "after" | "before" | null,
): SQL[] {
  const logicalAsc = direction === "asc";
  const physicalAsc = mode === "before" ? !logicalAsc : logicalAsc;
  const apply = physicalAsc ? asc : desc;
  return [...columns, idColumn].map((column) => apply(column));
}

export interface DirectionalKeysetColumn {
  column: Comparable;
  direction: "asc" | "desc";
}

/** Lexicographic boundary for independent per-column sort directions. */
export function directionalKeysetBoundary(
  entries: readonly DirectionalKeysetColumn[],
  values: readonly KeysetValue[],
  idColumn: Comparable,
  id: string,
  mode: "after" | "before",
): SQL | undefined {
  if (entries.length === 0 || entries.length !== values.length) return undefined;
  const forward = mode === "after";
  const disjunction: SQL[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as DirectionalKeysetColumn;
    const greater = entry.direction === "asc" ? forward : !forward;
    const compare = greater ? gt : lt;
    const equals = entries
      .slice(0, index)
      .map((prior, priorIndex) => eq(prior.column, values[priorIndex] as KeysetValue));
    disjunction.push(and(...equals, compare(entry.column, values[index] as KeysetValue)) as SQL);
  }
  const allEqual = entries.map((entry, index) => eq(entry.column, values[index] as KeysetValue));
  const idDirection = entries.at(-1)?.direction ?? "asc";
  const idGreater = idDirection === "asc" ? forward : !forward;
  disjunction.push(and(...allEqual, (idGreater ? gt : lt)(idColumn, id)) as SQL);
  return or(...disjunction);
}

export function directionalKeysetOrder(
  entries: readonly DirectionalKeysetColumn[],
  idColumn: Comparable,
  mode: "after" | "before" | null,
): SQL[] {
  const reverse = mode === "before";
  const order = entries.map((entry) => {
    const ascending = reverse ? entry.direction !== "asc" : entry.direction === "asc";
    return (ascending ? asc : desc)(entry.column);
  });
  const idDirection = entries.at(-1)?.direction ?? "asc";
  const idAscending = reverse ? idDirection !== "asc" : idDirection === "asc";
  return [...order, (idAscending ? asc : desc)(idColumn)];
}
