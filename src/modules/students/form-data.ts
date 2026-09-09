import { getTranslations } from "next-intl/server";
import { formOptions, lookupTable } from "@/lib/lookups.ts";
import { readProfessorOptions } from "@/modules/directory/options.ts";
import { FIELD_GROUPS, labelKey, STUDENT_FIELDS, STUDENT_LOOKUP_SETS } from "./fields.ts";
import type { StudentRecord } from "./record.ts";

/**
 * Everything the form needs, assembled on the server.
 *
 * The form is a client component and can read neither the database nor the
 * message catalogue, so both are resolved here and handed over as plain data.
 * Shared by the new and the edit pages because they differ in exactly two
 * things — the values and where the submit goes — and duplicating this
 * assembly is how those two screens drift apart.
 */
export async function buildFormProps(tenantId: string, record?: StudentRecord) {
  const [lookups, professors, t] = await Promise.all([
    lookupTable(tenantId, STUDENT_LOOKUP_SETS),
    readProfessorOptions(tenantId),
    getTranslations("students"),
  ]);

  const setOf = (key: string) => STUDENT_FIELDS.find((field) => field.key === key)?.set;

  const options: Record<string, { value: string; label: string; parent?: string }[]> = {};
  for (const field of STUDENT_FIELDS) {
    if (field.kind === "reference") {
      options[field.key] = professors.map((professor) => ({
        value: professor.id,
        label: professor.name,
      }));
      continue;
    }
    if (field.kind !== "lookup" || !field.set) continue;
    const parentSet = field.narrowedBy ? setOf(field.narrowedBy) : undefined;
    options[field.key] = formOptions(lookups, field.set, parentSet);
  }

  /*
   * Values as strings, because that is what an input holds and what a form
   * posts. `null` becomes `""` — the same "not recorded" the validator turns
   * back into `null` on the way in, so a field left alone survives a round trip
   * unchanged rather than becoming an empty string in the database.
   */
  const values: Record<string, string> = {};
  for (const field of STUDENT_FIELDS) {
    const raw = record?.[field.key as keyof StudentRecord];
    values[field.key] =
      raw === null || raw === undefined ? "" : typeof raw === "boolean" ? String(raw) : String(raw);
  }

  const labels = Object.fromEntries(STUDENT_FIELDS.map((field) => [field.key, t(labelKey(field))]));
  const hints = Object.fromEntries(
    STUDENT_FIELDS.filter((field) => field.hint).map((field) => [
      field.hint as string,
      t(field.hint as string),
    ]),
  );
  const groupLabels = Object.fromEntries(
    FIELD_GROUPS.map((group) => [
      group,
      { title: t(`group.${group}`), hint: t(`section.${group}Hint`) },
    ]),
  );

  return { options, values, labels, hints, groupLabels };
}
