/**
 * Whether a field actually changed, and therefore whether the trail records it.
 *
 * Its own module, with nothing imported: it is called from the Server Actions
 * that write records, and a test that reached it through one of those would
 * drag a database connection in behind it. Pure logic belongs where it can be
 * exercised on its own.
 *
 * The stakes are the audit trail's readability. Every field this says differs
 * becomes a line under an entry on the record's history tab, so a rule that is
 * too eager turns one edited field into an entry naming five — and a history
 * nobody can skim is a history nobody opens. The other direction is rarer and
 * worse: a rule too lax drops a real edit out of the record entirely.
 */
export function same(kind: string, from: unknown, to: unknown): boolean {
  const absent = (value: unknown) => value === null || value === undefined || value === "";

  /*
   * A checkbox has two states, not three.
   *
   * An unticked box posts nothing, so the form always sends `false` — while a
   * record written before that field existed holds `null`. Those are the same
   * state to anybody reading the form, but `absent(null) !== absent(false)`, so
   * every unticked box on an older record was recorded as an edit from nothing
   * to false: one save of one field wrote a trail entry naming four.
   *
   * Tested before the general absence rule, because that rule is about text and
   * numbers — where «not recorded» genuinely differs from a value.
   */
  if (kind === "boolean") return Boolean(from) === Boolean(to);

  if (absent(from) && absent(to)) return true;
  if (absent(from) !== absent(to)) return false;

  /*
   * By value, not by spelling. A GPA arrives from PostgreSQL as the string
   * «17.50» and from the form as the number 17.5; compared as text they differ,
   * and every save of an untouched record would log a change nobody made.
   */
  if (kind === "number") return Number(from) === Number(to);
  return String(from) === String(to);
}

/**
 * Semantic equality for JSON columns.
 *
 * PostgreSQL `jsonb` is free to return object keys in a different order from
 * the one a browser posted. Plain `JSON.stringify` would then manufacture an
 * edit where only key order changed. Arrays remain ordered — attendance and
 * printed rosters deliberately preserve their sequence — while object keys are
 * sorted recursively before comparison.
 */
export function sameJson(from: unknown, to: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonical(nested)]),
      );
    }
    return value ?? null;
  };

  return JSON.stringify(canonical(from)) === JSON.stringify(canonical(to));
}
