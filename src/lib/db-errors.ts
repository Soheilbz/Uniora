/**
 * Finds a PostgreSQL error code through the wrappers used by Drizzle and the
 * driver. Server Actions use this at the boundary so an expected constraint
 * race becomes an actionable form result instead of a generic 500.
 */
export function hasDatabaseErrorCode(cause: unknown, code: string): boolean {
  let current: unknown = cause;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
