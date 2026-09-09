/**
 * Setting one field across a selection of records.
 *
 * ── Why the field list is an allow-list ─────────────────────────────────────
 *
 * A bulk edit is the one operation in the registry that touches records the
 * operator is not looking at. So it may only set fields where a single value
 * across a selection is a thing somebody actually means: a student's standing,
 * a degree, an academic rank — vocabulary values, chosen from a list. Never a
 * name, a national id, a thesis title or a date, because "set the same one on
 * forty records" is not an edit anybody intends on those, and offering it makes
 * a mis-click into a data loss nobody can see.
 *
 * The list is declared per register beside its fields, and this module refuses
 * anything that is not on it — the *action* checks, not the dialog, because the
 * dialog constrains a form and the action is a public endpoint.
 *
 * ── Why there is a ceiling ──────────────────────────────────────────────────
 *
 * 500, the same as the application's. Not a technical limit — one `update
 * … where id = any(...)` would take the whole register — but a judgement: a
 * selection larger than that is one somebody made with «select all» rather than
 * by choosing, and an edit to four thousand records should be a deliberate act
 * with somebody's name on it rather than two clicks.
 */

export const MAX_BULK_EDIT_RECORDS = 500;

/** A field a bulk edit may set, with the values it may set it to. */
export interface BulkEditableField {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * The fields of a register that a bulk edit may touch.
 *
 * Built from the register's own field list rather than typed out again, so a
 * field that stops being a vocabulary — or stops existing — leaves the bulk
 * dialog by construction. A key on the allow-list that names no field, or names
 * one with no options, is dropped rather than offered as an empty select.
 */
export function bulkEditableFields(
  fields: readonly { key: string; kind: string; set?: string | undefined }[],
  allowed: readonly string[],
  optionsFor: (set: string) => { value: string; label: string }[],
  labelFor: (key: string) => string,
): BulkEditableField[] {
  /* Walked in *allow-list* order, not field-list order: the list above names
     status before degree because that is the edit an office reaches for first,
     and the dialog opens on the first entry it can build. */
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return allowed
    .flatMap((key) => {
      const field = byKey.get(key);
      if (field?.kind !== "lookup" || !field.set) return [];
      return [
        {
          key,
          label: labelFor(key),
          options: optionsFor(field.set),
        },
      ];
    })
    .filter((field): field is BulkEditableField => field.options.length > 0);
}
