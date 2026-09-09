import type { Comparable, DirectionalKeysetColumn } from "./keyset.ts";
import { type RegisterQuery, type RegisterSort, sortSequence } from "./spec.ts";

/**
 * Expands logical register sort keys into their normalized SQL expressions.
 * A logical key such as `name` may be two physical expressions (last, first),
 * and every expression inherits that key's requested direction.
 */
export function directionalOrderFor(
  orders: Readonly<Record<string, Comparable[]>>,
  query: RegisterQuery,
  fallbackKey: string,
  normalizeDirection: (sort: RegisterSort) => "asc" | "desc" = (sort) => sort.direction,
): DirectionalKeysetColumn[] {
  const expanded = sortSequence(query)
    .slice(0, 3)
    .flatMap((sort) =>
      (orders[sort.key] ?? []).map((column) => ({ column, direction: normalizeDirection(sort) })),
    )
    .slice(0, 6);
  if (expanded.length > 0) return expanded;
  return (orders[fallbackKey] ?? [])
    .slice(0, 6)
    .map((column) => ({ column, direction: query.direction }));
}

export function cursorValues(values: readonly unknown[], count: number): (string | number)[] {
  return values
    .slice(0, count)
    .map((value) => (typeof value === "number" ? value : String(value ?? "")));
}
