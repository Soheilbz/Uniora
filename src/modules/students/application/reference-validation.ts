import { and, inArray, isNull } from "drizzle-orm";
import { lookups, professors } from "@/db/schema.ts";
import type { withTenant } from "@/db/tenant.ts";
import { STUDENT_FIELDS } from "../fields.ts";

export async function collectReferenceErrors(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};

  /*
   * Most student lookups are intentionally open suggestions. Keep this guard
   * for any future closed lookup so the action remains the authority for that
   * distinction instead of trusting the browser.
   */
  const closedLookups = STUDENT_FIELDS.filter(
    (field) => field.kind === "lookup" && !field.allowCustom && values[field.key],
  );
  if (closedLookups.length > 0) {
    const sets = [...new Set(closedLookups.map((field) => field.set as string))];
    const known = await tx
      .select({ set: lookups.set, value: lookups.value })
      .from(lookups)
      .where(inArray(lookups.set, sets));
    const pairs = new Set(known.map((row) => `${row.set}:${row.value}`));
    for (const field of closedLookups) {
      if (!pairs.has(`${field.set}:${String(values[field.key])}`)) {
        errors[field.key] = "lookup.unknown";
      }
    }
  }

  const referenceFields = STUDENT_FIELDS.filter(
    (field) => field.kind === "reference" && values[field.key],
  );
  if (referenceFields.length > 0) {
    const ids = [...new Set(referenceFields.map((field) => String(values[field.key])))];
    const found = await tx
      .select({ id: professors.id })
      .from(professors)
      .where(and(inArray(professors.id, ids), isNull(professors.deletedAt)));
    const live = new Set(found.map((row) => row.id));

    for (const field of referenceFields) {
      const value = String(values[field.key]);
      if (live.has(value)) continue;
      if (before && String(before[field.key] ?? "") === value) continue;
      errors[field.key] = "reference.unknown";
    }
  }

  /*
   * The same professor in two supervision slots.
   *
   * Not a database constraint, because the columns are independent and a
   * constraint spanning four of them would be unreadable. It is a real mistake
   * though — a clerk picks the same name twice from four similar boxes — and it
   * produces a record the council's reports count as two supervisors.
   */
  const supervision = [
    "primarySupervisorId",
    "secondarySupervisorId",
    "thirdSupervisorId",
    "advisorId",
  ];
  const seen = new Map<string, string>();
  for (const key of supervision) {
    const value = values[key];
    if (!value || typeof value !== "string") continue;
    if (seen.has(value)) errors[key] = "reference.duplicate";
    else seen.set(value, key);
  }

  return errors;
}

/** Only the fields the form owns — never `id`, `tenantId` or `version`. */
