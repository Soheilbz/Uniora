/** Input ceilings shared by URL-driven and client-side search surfaces. */
export const MAX_SEARCH_LENGTH = 100;

/**
 * A decimal integer from a URL/form-like scalar, with the entire value consumed.
 *
 * `parseInt("12oops") === 12`, which is convenient for prose and wrong for
 * application state: a malformed address must not silently become a different
 * valid address. Repeated query parameters use their first value, matching the
 * rest of the URL readers.
 */
export function parseIntegerParam(value: string | string[] | undefined): number | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
