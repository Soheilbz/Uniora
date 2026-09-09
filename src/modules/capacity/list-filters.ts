import type { CapacityExplanation, CapacityProfessor } from "./engine.ts";
import type { CapacityReading } from "./queries.ts";
import type { ReviewerRow } from "./reviewers.ts";

/** The four states the capacity register can filter by. */
export const CAPACITY_STATES = ["noQuota", "exceeded", "nearLimit", "within"] as const;
export type CapacityState = (typeof CAPACITY_STATES)[number];

export function capacityState(explanation: CapacityExplanation): CapacityState {
  const tables = [explanation.dissertation, explanation.thesis];
  if (tables.every((table) => table.allowance === null)) return "noQuota";
  if (tables.some((table) => table.remaining !== null && table.remaining < 0)) return "exceeded";
  if (
    tables.some(
      (table) =>
        table.allowance !== null &&
        table.allowance > 0 &&
        table.remaining !== null &&
        table.remaining / table.allowance <= 0.2,
    )
  ) {
    return "nearLimit";
  }
  return "within";
}

export interface CapacityListRow {
  explanation: CapacityExplanation;
  professor: CapacityProfessor | undefined;
  who: { name: string; code: string | null };
}

/** The capacity engine's map as the one row shape used by screen and export. */
export function capacityListRows(reading: CapacityReading): CapacityListRow[] {
  const directory = new Map(reading.directory.map((entry) => [entry.id, entry] as const));
  return [...reading.explanations.values()]
    .map((explanation) => ({
      explanation,
      professor: directory.get(explanation.professorId),
      who: reading.names.get(explanation.professorId) ?? {
        name: explanation.professorId,
        code: null,
      },
    }))
    .sort((left, right) => left.who.name.localeCompare(right.who.name, "fa"));
}

export interface CapacityFilters {
  search: string;
  rank: string;
  state: string;
  university: string;
  faculty: string;
  department: string;
  specialization: string;
}

export function filterCapacityRows(
  rows: readonly CapacityListRow[],
  filter: CapacityFilters,
): CapacityListRow[] {
  const needle = filter.search.toLocaleLowerCase();
  return rows.filter(
    ({ explanation, who, professor }) =>
      (!needle || who.name.toLocaleLowerCase().includes(needle)) &&
      (!filter.rank || explanation.rank === filter.rank) &&
      (!filter.state || capacityState(explanation) === filter.state) &&
      (!filter.university || professor?.university === filter.university) &&
      (!filter.faculty || professor?.faculty === filter.faculty) &&
      (!filter.department || professor?.department === filter.department) &&
      (!filter.specialization || professor?.specialization === filter.specialization),
  );
}

export interface ReviewerFilters {
  search: string;
  kind: string;
  minimum: number | null;
  university: string;
  faculty: string;
  department: string;
  specialization: string;
}

export function filterReviewerRows(
  rows: readonly ReviewerRow[],
  filter: ReviewerFilters,
): ReviewerRow[] {
  const needle = filter.search.toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (!needle || row.name.toLocaleLowerCase().includes(needle)) &&
      (!filter.kind ||
        (filter.kind === "external" ? row.professorId === null : row.professorId !== null)) &&
      (filter.minimum === null || row.reviews >= filter.minimum) &&
      (!filter.university || row.university === filter.university) &&
      (!filter.faculty || row.faculty === filter.faculty) &&
      (!filter.department || row.department === filter.department) &&
      (!filter.specialization || row.specialization === filter.specialization),
  );
}
