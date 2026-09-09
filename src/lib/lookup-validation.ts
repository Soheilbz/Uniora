import { inArray } from "drizzle-orm";
import { lookups } from "@/db/schema.ts";
import type { withTenant } from "@/db/tenant.ts";

export interface LookupFieldLike {
  key: string;
  kind?: string;
  set?: string;
  allowCustom?: boolean;
}

/**
 * Lookup values a write may introduce now.
 *
 * Retired entries remain readable and may stay on a historical record, but a
 * crafted Server Action request must not be able to select one after the UI has
 * withdrawn it. `before` therefore makes one narrow exception: an unchanged
 * historical value may survive an unrelated edit. A changed value must be a
 * current entry in this tenant's vocabulary.
 */
export async function currentLookupErrors(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  fields: readonly LookupFieldLike[],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const used = fields.filter(
    (field) =>
      field.kind === "lookup" &&
      !field.allowCustom &&
      field.set &&
      values[field.key] !== null &&
      values[field.key] !== undefined &&
      String(values[field.key]) !== "",
  );
  if (used.length === 0) return {};

  const sets = [...new Set(used.map((field) => field.set as string))];
  const rows = await tx
    .select({ set: lookups.set, value: lookups.value, retiredAt: lookups.retiredAt })
    .from(lookups)
    .where(inArray(lookups.set, sets));

  const current = new Set(
    rows.filter((row) => row.retiredAt === null).map((row) => `${row.set}:${row.value}`),
  );

  const errors: Record<string, string> = {};
  for (const field of used) {
    const value = String(values[field.key]);
    if (current.has(`${field.set}:${value}`)) continue;
    if (before && String(before[field.key] ?? "") === value) continue;
    errors[field.key] = "lookup.unknown";
  }
  return errors;
}
