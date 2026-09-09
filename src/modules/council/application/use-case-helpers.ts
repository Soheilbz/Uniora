import { eq } from "drizzle-orm";
import { type councilDecisions, councilMeetings } from "@/db/schema.ts";
import type { withTenant } from "@/db/tenant.ts";
import { currentLookupErrors } from "@/lib/lookup-validation.ts";
import { validatedColumns } from "@/lib/register/columns.ts";
import { type CouncilField, DECISION_FIELDS, MEETING_FIELDS } from "../fields.ts";

export class ValidationFailure extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}

export class MissingReference extends Error {
  constructor() {
    super("missing reference");
    this.name = "MissingReference";
  }
}

export async function assertMeetingReference(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  meetingId: string | null,
) {
  if (!meetingId) return;
  /* Historical children may remain linked to a retired sitting. RLS supplies
     the tenant boundary; existence, not active status, is the invariant here. */
  const [meeting] = await tx
    .select({ id: councilMeetings.id })
    .from(councilMeetings)
    .where(eq(councilMeetings.id, meetingId))
    .limit(1);
  if (!meeting) throw new MissingReference();
}

export function payloadFrom(
  fields: readonly CouncilField[],
  form: FormData,
): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, String(form.get(field.key) ?? "")]));
}

/**
 * The validated payload, as columns.
 *
 * The only casts in this file. The schemas are assembled from field lists with
 * `Object.fromEntries`, so their inferred type is `Record<string, unknown>` —
 * TypeScript cannot see that `meetingNumber` is among the keys, and drizzle
 * therefore cannot see that the insert has the column it requires.
 *
 * What makes them safe is that every key comes from a field list, and that every
 * key in those lists is a real writable column is checked by `fields.test.ts`
 * against the table definitions rather than asserted here. A typo would
 * otherwise be invisible: the column would simply never be written, and the
 * value would vanish on save.
 */
export function asMeeting(values: Record<string, unknown>) {
  return validatedColumns<Omit<typeof councilMeetings.$inferInsert, "tenantId">>(
    MEETING_FIELDS,
    values,
  );
}

export function asDecision(values: Record<string, unknown>) {
  return validatedColumns<Omit<typeof councilDecisions.$inferInsert, "tenantId">>(
    DECISION_FIELDS,
    values,
  );
}

export function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** Lookup values must be current, except an unchanged historical value on edit. */
export async function unknownLookups(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  fields: readonly CouncilField[],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<Record<string, string>> {
  return currentLookupErrors(tx, fields, values, before);
}

/**
 * The names on the record that are not the same person twice.
 *
 * A clerk filling eleven near-identical boxes picks the same professor into two
 * of them, and the result is a dossier the council's reports count as having two
 * supervisors. Not a database constraint — eleven independent columns cannot
 * carry one — and not something the form can prevent, because the boxes are free
 * text by design.
 *
 * Folded before comparing, so «سعيد نظيفي» typed into one box and «سعید نظیفی»
 * into another are caught as the collision they are.
 */
export function duplicateSeats(values: Record<string, unknown>, seats: readonly string[]) {
  const errors: Record<string, string> = {};
  const seen = new Map<string, string>();

  for (const seat of seats) {
    const value = values[seat];
    if (typeof value !== "string" || !value.trim()) continue;
    const folded = value
      .trim()
      .replace(/[يیۍئې]/g, "ی")
      .replace(/[كکڪ]/g, "ک")
      .replace(/[آأإٱ]/g, "ا")
      .replace(/\s+/g, " ");
    if (seen.has(folded)) errors[seat] = "seat.duplicate";
    else seen.set(folded, seat);
  }

  return errors;
}

/**
 * The attendance lists, from the two textareas that hold them.
 *
 * One name per line, order preserved — the order is what the minute prints.
 * Blank lines are dropped, because a trailing newline is not an attendee, and
 * duplicates within one list are collapsed: the same name twice in «حاضران» is
 * a slip, and it would print twice on the minute.
 */
export function namesFrom(form: FormData, key: string): string[] | null {
  const names = [
    ...new Set(
      String(form.get(key) ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  if (names.length > 200 || names.some((name) => name.length > 200)) return null;
  return names;
}

/**
 * The structured stand-in map posted by the attendance editor.
 *
 * It is deliberately parsed independently of the ordinary field schema:
 * substitutions are not a text field, they are a bounded name-to-name map. A
 * malformed JSON body or an object containing non-string/empty/oversized names
 * is rejected before a transaction reaches PostgreSQL.
 */
export function substitutionsFrom(form: FormData): Record<string, string> | null {
  const raw = String(form.get("substitutions") ?? "{}").trim() || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 100) return null;

  const substitutions: Record<string, string> = {};
  for (const [rawMember, rawDeputy] of entries) {
    if (typeof rawDeputy !== "string") return null;
    const member = rawMember.trim();
    const deputy = rawDeputy.trim();
    if (!member || !deputy || member.length > 200 || deputy.length > 200 || member === deputy) {
      return null;
    }
    substitutions[member] = deputy;
  }
  const deputies = Object.values(substitutions);
  if (new Set(deputies).size !== deputies.length) return null;
  return substitutions;
}

/**
 * PostgreSQL's unique-violation code, turned into an error on the right box.
 *
 * Two clerks filing sitting ۶۸۲ at once is the ordinary case. Reported as a
 * general failure it reads as "the system is broken"; on the field it reads as
 * "this number is taken", which is true and actionable.
 */
export function isDuplicate(cause: unknown): boolean {
  /* Walks the cause chain: Drizzle wraps the PostgreSQL error, and a top-only
     code check never sees the 23505 — the duplicate became an unhandled
     server error instead of a field message. See the students' action. */
  let current: unknown = cause;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
