/**
 * Whether a string is shaped like the uuids this application's rows carry.
 *
 * Route segments arrive as whatever the URL says. Handing «not-a-uuid» to a
 * `where id = $1` against a uuid column makes PostgreSQL refuse the *query* —
 * a 500 whose stack names the database — where the honest answer is simply
 * "no such record". Checked before the query, a malformed segment takes the
 * same path a well-formed but absent one does: the not-found boundary.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_SHAPE.test(value);
}

/**
 * A bounded UUID selection from an untrusted form body.
 *
 * Invalid or oversized input fails closed rather than quietly dropping the bad
 * entries or truncating the tail. Silent filtering turns a malformed request
 * into a different, partially successful destructive action — the caller can
 * no longer tell which records it actually acted on.
 */
export function uuidList(values: readonly unknown[], maximum: number): string[] | null {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || values.length > maximum) return null;
  const ids = values.map(String);
  if (ids.some((id) => !isUuid(id))) return null;
  return [...new Set(ids)];
}
