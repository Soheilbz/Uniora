/**
 * Every message this module can put on a field, as a closed list.
 *
 * These are catalogue paths, and a path that does not resolve fails in the worst
 * available way: next-intl renders the *key* — «errors.text.nationalId» — on the
 * one screen, in the one condition, that produces it. It typechecks, it lints,
 * it passes every test that does not submit an invalid national id, and the
 * first person to see it is an operator who has just made a mistake and is now
 * being shown a fragment of source code.
 *
 * That is not hypothetical: the flat key `"text.nationalId"` did exactly this,
 * because next-intl reads a dot as nesting and the catalogue had the string as
 * one literal key. Nesting the catalogue fixed it; this list, and the test that
 * resolves every entry of it against both catalogues, is what stops the next
 * one.
 */
export const ERROR_KEYS = [
  "required",
  "duplicate",
  "text.tooLong",
  "bulk.field",
  "bulk.value",
  "bulk.selection",
  "text.digitsOnly",
  "text.nationalId",
  "text.email",
  "text.tel",
  "text.time",
  "number.invalid",
  "number.range",
  "number.scale",
  "date.invalid",
  "lookup.unknown",
  "choice.unknown",
  "reference.unknown",
  "reference.duplicate",
  "professor.supervising",
  "record.missing",
  "record.conflict",
  "seat.duplicate",
  "attendance.onBothLists",
  "attendance.invalidSubstitutions",
  "attendance.invalidNames",
  /* Saved views: the one refusal the register's own bookmark dialog can meet. */
  "views.tooMany",
  "permission",
] as const;

export type ErrorKey = (typeof ERROR_KEYS)[number];
