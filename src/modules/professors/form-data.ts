import { getTranslations } from "next-intl/server";
import { choiceOptions, formOptions, lookupTable } from "@/lib/lookups.ts";
import { PROFESSOR_FIELDS, PROFESSOR_GROUPS, PROFESSOR_LOOKUP_SETS } from "./fields.ts";

/**
 * Everything the professor form needs, assembled on the server.
 *
 * The form is a client component and can read neither the database nor the
 * message catalogue, so both are resolved here and handed over as plain data.
 * Shared by the new and the edit pages because they differ in exactly two
 * things — the values and where the submit goes — and duplicating this assembly
 * is how those two screens drift apart.
 */
export async function buildProfessorForm(
  tenantId: string,
  record?: Record<string, unknown> | null,
) {
  const [lookups, t, root] = await Promise.all([
    lookupTable(tenantId, PROFESSOR_LOOKUP_SETS),
    getTranslations("professors"),
    /* Unnamespaced, because a choice's `labelKey` is a path from the root: the
       yes/no answer is worded once for the whole application. */
    getTranslations(),
  ]);

  const setOf = (key: string) => PROFESSOR_FIELDS.find((field) => field.key === key)?.set;

  const options: Record<string, { value: string; label: string; parent?: string }[]> = {};
  for (const field of PROFESSOR_FIELDS) {
    if (field.kind === "choice") {
      options[field.key] = choiceOptions(field.choices, (key) => root(key));
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
  for (const field of PROFESSOR_FIELDS) {
    const raw = record?.[field.key];
    values[field.key] = raw === null || raw === undefined ? "" : String(raw);
  }

  const labels = Object.fromEntries(
    PROFESSOR_FIELDS.map((field) => [field.key, t(`field.${field.key}`)]),
  );
  const hints = Object.fromEntries(
    PROFESSOR_FIELDS.filter((field) => field.hint).map((field) => [
      field.hint as string,
      t(field.hint as string),
    ]),
  );
  const groupLabels = Object.fromEntries(
    PROFESSOR_GROUPS.map((group) => [
      group,
      { title: t(`group.${group}`), hint: t(`section.${group}Hint`) },
    ]),
  );

  return { options, values, labels, hints, groupLabels };
}
