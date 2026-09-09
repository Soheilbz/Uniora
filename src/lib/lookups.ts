import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { lookups } from "@/db/schema.ts";
import { readOnly, type TenantTx } from "@/db/tenant.ts";

/**
 * Reading the institution's vocabularies.
 *
 * Every register displays stored keys — `phd`, `on_leave`, `computer_engineering`
 * — and every one of them has to become a word before it reaches a screen. This
 * is the one place that translation happens, and it happens on the server: the
 * alternative is shipping the whole vocabulary to the browser on every page,
 * which is both larger than the page and a description of an institution's
 * structure handed to anyone who opens the developer tools.
 *
 * `cache()` collapses the read to once per request. A register page asks for six
 * sets — degrees, statuses, faculties, departments, fields, genders — and a
 * table of ten rows asks for the same six sets forty times between its cells.
 * That is one query.
 */

export interface LookupEntry {
  value: string;
  label: string;
  /** The row id of the entry this one sits under, if the set nests. */
  parentId: string | null;
  /** This entry's own row id, so a child can point at it. */
  id: string;
  position: number;
  /**
   * Withdrawn from the forms, and still legible on the records filed under it.
   *
   * Carried on the entry rather than filtered out of the table, because the two
   * readers want opposite things: `optionsFor` must not offer it, and `labelOf`
   * must still find it — a student filed under «دستیاری تخصصی» three years ago
   * would otherwise display the bare key.
   */
  retired: boolean;
}

export type LookupTable = Map<string, LookupEntry[]>;

export function entriesForDisplay(
  table: LookupTable,
  set: string,
  _value: string | null | undefined,
): LookupEntry[] {
  return table.get(set) ?? [];
}

/**
 * Every entry in the named sets, in the office's order.
 *
 * Retired entries are included, deliberately. They must not be *offered* on a
 * form — `optionsFor` drops them — but a record filed under «دستیاری تخصصی»
 * three years ago still has to render that word today, and a lookup table that
 * omitted it would display the bare key `specialty` instead. Retirement stops an
 * entry being chosen; it does not un-file the records already carrying it.
 */
export async function lookupTableInTx(tx: TenantTx, sets: readonly string[]): Promise<LookupTable> {
  if (sets.length === 0) return new Map();

  const rows = await tx
    .select({
      id: lookups.id,
      set: lookups.set,
      value: lookups.value,
      label: lookups.label,
      parentId: lookups.parentId,
      position: lookups.position,
      retiredAt: lookups.retiredAt,
    })
    .from(lookups)
    .where(inArray(lookups.set, [...sets]))
    .orderBy(asc(lookups.set), asc(lookups.position), asc(lookups.label));

  const table: LookupTable = new Map();
  for (const row of rows) {
    const entries = table.get(row.set) ?? [];
    entries.push({
      id: row.id,
      value: row.value,
      label: row.label,
      parentId: row.parentId,
      position: row.position,
      retired: row.retiredAt !== null,
    });
    table.set(row.set, entries);
  }
  return table;
}

export const lookupTable = cache(
  async (tenantId: string, sets: readonly string[]): Promise<LookupTable> =>
    readOnly(tenantId, (tx) => lookupTableInTx(tx, sets)),
);

/**
 * The word for a stored value, or the value itself.
 *
 * Falling back to the raw key rather than to «—» or an empty cell is
 * deliberate, and it is the more useful of two imperfect options. A record
 * holding a value no vocabulary defines is a data fault — a bad import, a
 * vocabulary entry deleted instead of retired — and showing `ph_d_17rsace` makes
 * that visible to the person who can fix it. An empty cell reads as "this
 * student has no degree", which is a different and wrong statement.
 */
export function labelOf(table: LookupTable, set: string, value: string | null): string | null {
  if (!value) return null;
  return (
    entriesForDisplay(table, set, value).find((entry) => entry.value === value)?.label ?? value
  );
}

/** The entries a form may offer: everything in the set that is still current. */
export function optionsFor(
  table: LookupTable,
  set: string,
  parentValue?: string | null,
  parentSet?: string,
): LookupEntry[] {
  /*
   * Retired entries are dropped, as they are in `formOptions`.
   *
   * Both answer "what may be chosen now", so both give the same answer. What
   * deliberately does *not* filter is a register's filter strip: it reads the
   * table directly and keeps the retired entries, because there are records
   * filed under them and «find me the students on the degree we stopped
   * awarding» is a question the office actually asks.
   */
  const entries = (table.get(set) ?? []).filter((entry) => !entry.retired);
  if (!parentValue || !parentSet) return entries;

  /*
   * Narrowed to the entries belonging to the chosen parent.
   *
   * The parent is named by *value* — that is what the student's own column
   * holds — while the link is by row id, so the parent's id is resolved first.
   * A parent value that is not in the vocabulary narrows to nothing rather than
   * to everything: showing the full list would let a clerk file a student in a
   * department their faculty does not have, which is a record that is wrong
   * while every individual field on it is valid.
   */
  const parentId = table.get(parentSet)?.find((entry) => entry.value === parentValue)?.id;
  if (!parentId) return [];
  return entries.filter((entry) => entry.parentId === parentId);
}

/**
 * The current entries of one set, read straight from the table.
 *
 * Separate from `lookupTable` because it asks a different question — "what may
 * be chosen now" rather than "what do these stored values mean". Nothing on a
 * screen uses it today: the record forms take `formOptions`, which answers the
 * same question from the cached table and costs no extra query. It is kept for
 * the caller that wants the answer without warming the whole vocabulary.
 */
export async function currentEntries(tenantId: string, set: string): Promise<LookupEntry[]> {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: lookups.id,
        value: lookups.value,
        label: lookups.label,
        parentId: lookups.parentId,
        position: lookups.position,
        /* Always false: the `where` below already excludes the retired ones.
           Selected rather than assumed so the shape is the same `LookupEntry`
           every other reader gets. */
        retired: sql<boolean>`false`,
      })
      .from(lookups)
      .where(and(eq(lookups.set, set), isNull(lookups.retiredAt)))
      .orderBy(asc(lookups.position), asc(lookups.label)),
  );
}

/**
 * A set's entries with their parent named by *value* rather than by row id.
 *
 * The form needs this shape because it narrows on the client: when somebody
 * picks a faculty, the department box has to shorten immediately, and waiting
 * for a round trip to find out which departments that faculty holds would make
 * every choice on the form feel like a page load.
 *
 * The parent arrives as a value because that is what the sibling *field* holds —
 * `student.faculty` is «engineering», not a uuid — so the client can compare the
 * two directly without carrying the vocabulary's internal ids into the browser.
 */
export interface FormOption {
  value: string;
  label: string;
  /** The parent entry's `value`, for a set that nests. */
  parent?: string;
}

export function formOptions(table: LookupTable, set: string, parentSet?: string): FormOption[] {
  /*
   * Retired entries are dropped here too.
   *
   * This is the path the record forms actually take — `optionsFor` serves the
   * filters — and filtering only one of the two is how a withdrawn degree stays
   * on the one screen that can still file a student under it. Both readers ask
   * the same question, so both give the same answer.
   */
  const entries = (table.get(set) ?? []).filter((entry) => !entry.retired);
  const parents = parentSet ? table.get(parentSet) : undefined;
  const valueById = new Map(parents?.map((entry) => [entry.id, entry.value]));

  return entries.map((entry) => {
    const parent = entry.parentId ? valueById.get(entry.parentId) : undefined;
    return parent
      ? { value: entry.value, label: entry.label, parent }
      : { value: entry.value, label: entry.label };
  });
}

/**
 * The options for a code-defined `choice` field.
 *
 * Beside `formOptions` because both answer the same question for the form —
 * "what may this field hold" — and it is the form's business that one list
 * comes from the institution's vocabulary and the other from the program's own
 * source. `translate` takes a path from the root of the catalogue, so a yes/no
 * answer is worded once for the whole application rather than per register.
 */
export function choiceOptions(
  choices: readonly { value: string; labelKey: string }[] | undefined,
  translate: (key: string) => string,
): FormOption[] {
  return (choices ?? []).map((choice) => ({
    value: choice.value,
    label: translate(choice.labelKey),
  }));
}
