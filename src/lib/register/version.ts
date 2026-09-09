/**
 * Whether a posted optimistic-lock revision can safely be compared with an
 * integer `version` column.
 *
 * Server Actions are HTTP endpoints: a hidden input can be replaced with
 * `NaN`, an exponent, a fraction or a negative number. Passing those values on
 * to PostgreSQL turns a stale-form check into a database error. Versions in
 * this application are monotonically increasing, non-negative safe integers.
 */
export function isRecordVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
