/**
 * Application/use-case implementation for this bounded context.
 *
 * Kept outside the Server Action endpoint file so transport wiring stays thin.
 * Existing FormData contracts are preserved for backward compatibility; new
 * use-cases should accept typed command objects and leave revalidation to the
 * action adapter.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { professors } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { currentLookupErrors } from "@/lib/lookup-validation.ts";
import { formOptions, lookupTable } from "@/lib/lookups.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { MAX_BULK_EDIT_RECORDS } from "@/lib/register/bulk-edit.ts";
import { same } from "@/lib/register/changes.ts";
import { validatedColumns } from "@/lib/register/columns.ts";
import { importFor, planFor, rollbackFor } from "@/lib/register/import-action.ts";
import { schemaFor } from "@/lib/register/validation.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid, uuidList } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { PROFESSOR_FIELDS, PROFESSOR_LOOKUP_SETS } from "../fields.ts";
import { BULK_EDITABLE } from "../model.ts";

/**
 * Writing the professor register.
 *
 * Every one is a public endpoint — see the student register's actions for why
 * each re-derives the viewer, re-checks the capability and re-validates the
 * payload rather than trusting that this application's own form is the caller.
 */

const BASE = "/professors";

class ValidationFailure extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}

const professorSchema = schemaFor(PROFESSOR_FIELDS);

/** Only the fields the form owns — never `id`, `tenantId` or `version`. */
function payloadFrom(form: FormData): Record<string, string> {
  return Object.fromEntries(
    PROFESSOR_FIELDS.map((field) => [field.key, String(form.get(field.key) ?? "")]),
  );
}

/**
 * The validated payload, as columns.
 *
 * The one cast in this file, and what makes it safe is elsewhere: every key
 * comes from `PROFESSOR_FIELDS`, and that every key there names a real writable
 * column is checked by `fields.test.ts` against the table definition. A typo
 * would otherwise be invisible — the column would simply never be written and
 * the value would vanish on save.
 */
function asColumns(data: Record<string, unknown>) {
  return validatedColumns<Omit<typeof professors.$inferInsert, "tenantId">>(PROFESSOR_FIELDS, data);
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** PostgreSQL's unique-violation code — here, a professor code already taken. */
function isDuplicateCode(cause: unknown): boolean {
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

/** Closed vocabularies must be current, except an unchanged historical value on edit. */
async function checkVocabularies(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
) {
  const errors = await currentLookupErrors(tx, PROFESSOR_FIELDS, values, before);
  if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);
}

export async function createProfessor(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("professors.view", "professors.manage");

  const submitted = payloadFrom(form);
  const parsed = professorSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  let created: string | undefined;
  try {
    created = await withTenant(viewer.tenantId, async (tx) => {
      await checkVocabularies(tx, parsed.data);

      const [row] = await tx
        .insert(professors)
        .values({ ...asColumns(parsed.data), tenantId: viewer.tenantId })
        .returning({ id: professors.id });
      if (!row) throw new Error("insert returned nothing");

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "create",
        entityType: "professor",
        entityId: row.id,
      });

      return row.id;
    });
  } catch (cause) {
    if (cause instanceof ValidationFailure) {
      return { ok: false, errors: cause.errors, values: submitted };
    }
    if (isDuplicateCode(cause)) {
      return { ok: false, errors: { professorCode: "duplicate" }, values: submitted };
    }
    throw cause;
  }

  revalidatePath(BASE);
  /* Outside the try: `redirect` works by throwing, so called inside one it is
     caught by the handler meant for database faults. */
  redirect(`${BASE}/${created}`);
}

export async function updateProfessor(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("professors.view", "professors.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  if (id === "" || !isUuid(id) || !isRecordVersion(version)) {
    return { ok: false, message: "record.missing" };
  }

  const submitted = payloadFrom(form);
  const parsed = professorSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  try {
    const outcome = await withTenant(viewer.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(professors)
        .where(and(eq(professors.id, id), isNull(professors.deletedAt)))
        .limit(1);
      if (!before) return "missing" as const;
      if (before.version !== version) return "conflict" as const;
      await checkVocabularies(tx, parsed.data, before as Record<string, unknown>);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of PROFESSOR_FIELDS) {
        const from = (before as Record<string, unknown>)[field.key] ?? null;
        const to = (parsed.data as Record<string, unknown>)[field.key] ?? null;
        if (!same(field.kind, from, to)) changes[field.key] = { from, to };
      }
      if (Object.keys(changes).length === 0) return "unchanged" as const;

      const updated = await tx
        .update(professors)
        .set({ ...asColumns(parsed.data), version: version + 1, updatedAt: sql`now()` })
        .where(
          and(eq(professors.id, id), eq(professors.version, version), isNull(professors.deletedAt)),
        )
        .returning({ id: professors.id });

      /* The same optimistic guard every record here carries: two clerks with
         the record open, and without it the second save silently wins. */
      if (updated.length === 0) return "conflict" as const;

      /*
       * What actually changed, field by field.
       *
       * Compared against the row as it was, so a save that touched nothing
       * writes no audit entry — a trail full of «ویرایش» with no changes under
       * it is a trail nobody reads.
       */
      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "professor",
        entityId: id,
        changes: JSON.stringify(changes),
      });

      return "saved" as const;
    });

    if (outcome === "missing") return { ok: false, message: "record.missing", values: submitted };
    if (outcome === "conflict") return { ok: false, message: "record.conflict", values: submitted };
  } catch (cause) {
    if (cause instanceof ValidationFailure) {
      return Object.keys(cause.errors).length > 0
        ? { ok: false, errors: cause.errors, values: submitted }
        : { ok: false, message: "record.missing", values: submitted };
    }
    if (isDuplicateCode(cause)) {
      return { ok: false, errors: { professorCode: "duplicate" }, values: submitted };
    }
    throw cause;
  }

  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}
export async function deleteProfessors(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("professors.view", "professors.manage");
  const ids = uuidList(form.getAll("id"), 1);
  const version = Number(form.get("version") ?? "");
  if (ids === null || ids.length !== 1 || !isRecordVersion(version)) {
    return { ok: false, message: "errors.bulk.selection" };
  }
  const [id] = ids;
  if (!id) return { ok: false, message: "errors.bulk.selection" };

  const outcome = await withTenant(viewer.tenantId, async (tx) => {
    const [current] = await tx
      .select({ version: professors.version })
      .from(professors)
      .where(and(eq(professors.id, id), isNull(professors.deletedAt)))
      .limit(1);
    if (!current || current.version !== version) return "conflict" as const;

    const held = await tx.execute(sql`
      select count(*)::int as total from students s
      where s.deleted_at is null
        and (s.primary_supervisor_id = ${id}::uuid
          or s.secondary_supervisor_id = ${id}::uuid
          or s.third_supervisor_id = ${id}::uuid
          or s.advisor_id = ${id}::uuid)`);
    if (Number((held.rows[0] as { total: number } | undefined)?.total ?? 0) > 0) {
      return "supervising" as const;
    }

    const retired = await tx
      .update(professors)
      .set({ deletedAt: sql`now()` })
      .where(
        and(eq(professors.id, id), eq(professors.version, version), isNull(professors.deletedAt)),
      )
      .returning({ id: professors.id });
    if (retired.length === 0) return "conflict" as const;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "delete",
      entityType: "professor",
      entityId: id,
    });
    return "removed" as const;
  });

  if (outcome === "supervising") return { ok: false, message: "professor.supervising" };
  if (outcome === "conflict") return { ok: false, message: "errors.record.conflict" };
  revalidatePath(BASE);
  return { ok: true };
}

/**
 * Sets one vocabulary field across a selection of professors.
 *
 * ── What makes this safe ────────────────────────────────────────────────────
 *
 * Three checks, and none of them is the dialog's. The capability is re-derived
 * here; the field is checked against the register's own allow-list, so a request
 * naming `national_id` is refused however it was built; and the value is checked
 * against the vocabulary that field reads, so a request naming a status this
 * institution does not use is refused too. A Server Action is a public endpoint
 * and «the dialog only offered two fields» constrains the dialog.
 *
 * ── Every row keeps its own version guard ───────────────────────────────────
 *
 * The write matches on the version each row was read at, so a record somebody
 * else edited between the selection and the apply is skipped rather than
 * silently overwritten — the same guard a single-record save uses, applied
 * forty times. The count of what was actually written comes back, because
 * «۴۰ selected, ۳۸ changed» is the only honest report when two were stale.
 */
/** The columns a bulk edit may write, by field key — see the students' action. */
const BULK_COLUMN = {
  status: professors.status,
  academicRank: professors.academicRank,
} as const;

export async function bulkEditProfessors(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("professors.manage");

  const key = String(form.get("field") ?? "");
  const value = String(form.get("value") ?? "");
  const ids = uuidList(form.getAll("id"), MAX_BULK_EDIT_RECORDS);

  if (ids === null) return { ok: false, message: "errors.bulk.selection" };
  if (ids.length === 0) return { ok: true };
  if (!BULK_EDITABLE.includes(key)) return { ok: false, message: "errors.bulk.field" };

  const field = PROFESSOR_FIELDS.find((candidate) => candidate.key === key);
  if (!field?.set) return { ok: false, message: "errors.bulk.field" };
  /* The allow-list check above guarantees this key has a column. */
  const column = BULK_COLUMN[key as keyof typeof BULK_COLUMN];

  /* The value has to be one this institution actually offers — a vocabulary is
     editable, so an identifier that was valid last term may not be now, and a
     retired entry must not be settable across forty records at once. */
  const table = await lookupTable(viewer.tenantId, [field.set]);
  const offered = formOptions(table, field.set);
  if (!offered.some((option) => option.value === value)) {
    return { ok: false, message: "errors.bulk.value" };
  }

  const expectedById = new Map<string, number>();
  for (const id of ids) {
    const raw = form.get(`version.${id}`);
    const version = Number(raw);
    if (raw !== null && isRecordVersion(version)) expectedById.set(id, version);
  }
  if (expectedById.size !== ids.length) {
    return { ok: false, message: "errors.record.conflict" };
  }

  const changed = await withTenant(viewer.tenantId, async (tx) => {
    /* What the selection looks like right now, including the current value of
       the field — the «from» half of every audit entry below. */
    const current = await tx
      .select({ id: professors.id, version: professors.version, from: column })
      .from(professors)
      .where(and(inArray(professors.id, ids), isNull(professors.deletedAt)));

    /* Per-row version guard, grouped by version — see the students' bulk edit
       for the full reasoning. A record edited between ticking and applying is
       skipped and left out of the count rather than overwritten. */
    const groups = new Map<number, string[]>();
    const fromById = new Map<string, unknown>();
    for (const row of current) {
      fromById.set(row.id, row.from);
      const expected = expectedById.get(row.id);
      if (expected === undefined || row.version !== expected) continue;
      if (same("text", row.from, value)) continue;
      const bucket = groups.get(expected);
      if (bucket) bucket.push(row.id);
      else groups.set(expected, [row.id]);
    }

    let changedCount = 0;
    for (const [expected, groupIds] of groups) {
      const updated = await tx
        .update(professors)
        .set({ [key]: value, updatedAt: new Date(), version: sql`version + 1` })
        .where(
          and(
            inArray(professors.id, groupIds),
            eq(professors.version, expected),
            isNull(professors.deletedAt),
          ),
        )
        .returning({ id: professors.id });

      changedCount += updated.length;

      if (updated.length > 0) {
        await writeAuditEvent(
          tx,
          updated.map((row) => ({
            tenantId: viewer.tenantId,
            actorId: viewer.userId,
            action: "update",
            /* These are professors. The trail files their changes
               under entities that do not exist — a copy-paste survivor that
               made the history tab answer questions nobody asked. */
            entityType: "professor",
            entityId: row.id,
            changes: JSON.stringify({
              [key]: { from: fromById.get(row.id) ?? null, to: value },
            }),
          })),
        );
      }
    }

    return changedCount;
  });

  revalidatePath(BASE);
  return { ok: true, values: { changed: String(changed) } };
}
/**
 * The professor directory's import.
 *
 * The professor code is the key — the register's own unique index is on it, and
 * it is what a personnel spreadsheet carries.
 */
const PROFESSOR_IMPORT = {
  table: professors,
  id: professors.id,
  deletedAt: professors.deletedAt,
  version: professors.version,
  keyColumn: professors.professorCode,
  keyField: "professorCode",
  fields: PROFESSOR_FIELDS,
  lookupSets: PROFESSOR_LOOKUP_SETS,
  schema: professorSchema,
  namespace: "professors",
  entityType: "professor",
};

/** What a file would do, without writing any of it. */
export async function planProfessorImport(text: string) {
  const viewer = await requireCapability("professors.view", "professors.manage");
  const { plan } = await planFor(viewer.tenantId, PROFESSOR_IMPORT, text);
  return plan;
}

/** The same file, written. */
export async function importProfessors(text: string) {
  const viewer = await requireCapability("professors.view", "professors.manage");
  const outcome = await importFor(viewer.tenantId, viewer.userId, PROFESSOR_IMPORT, text);
  revalidatePath(BASE);
  return outcome;
}

export async function rollbackProfessorImport(batchId: string) {
  const viewer = await requireCapability("professors.view", "professors.manage");
  const outcome = await rollbackFor(viewer.tenantId, viewer.userId, PROFESSOR_IMPORT, batchId);
  if (outcome.rolledBack > 0) revalidatePath(BASE);
  return outcome;
}

/**
 * Retiring one professor, from their own record.
 *
 * Delegates to the batch above rather than repeating it, so the rule that
 * matters — a professor still holding a supervision seat is not removed —
 * cannot be true on one path and not the other. On success it redirects,
 * because the page it was pressed from is the edit screen of a record that no
 * longer exists.
 */
export async function deleteProfessor(
  previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const result = await deleteProfessors(previous, form);
  if (!result.ok) return result;
  redirect(BASE);
}
