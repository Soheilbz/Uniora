import type { AnyFieldSpec } from "./field-spec.ts";

/**
 * Bridge a dynamically-built validator to a statically-typed Drizzle insert.
 *
 * `schemaFor()` necessarily returns a record type because its keys come from a
 * field catalogue at runtime. Keep the unavoidable assertion in one place and
 * surround it with runtime invariants: every declared field must be present and
 * no undeclared key may cross into the write payload. Domain field-contract
 * tests separately prove that the catalogue keys are real writable columns.
 */
export function validatedColumns<Insert extends object>(
  fields: readonly AnyFieldSpec[],
  values: Record<string, unknown>,
): Insert {
  const allowed = new Set(fields.map((field) => field.key));
  for (const field of fields) {
    if (!(field.key in values)) throw new Error(`validated payload missing field: ${field.key}`);
  }
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) throw new Error(`validated payload contains undeclared field: ${key}`);
  }
  return values as Insert;
}
