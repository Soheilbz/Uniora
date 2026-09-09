/**
 * Application/use-case implementation for this bounded context.
 *
 * Kept outside the Server Action endpoint file so transport wiring stays thin.
 * Existing FormData contracts are preserved for backward compatibility; new
 * use-cases should accept typed command objects and leave revalidation to the
 * action adapter.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { students } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { same } from "@/lib/register/changes.ts";
import { isUuid, uuidList } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { STUDENT_FIELDS } from "../fields.ts";
import { studentSchema } from "../validation.ts";
import { collectReferenceErrors } from "./reference-validation.ts";

/**
 * Writing a student record.
 *
 * ── Every one of these is a public endpoint ─────────────────────────────────
 *
 * A Server Action compiles to an HTTP endpoint with a generated name, and
 * anybody who has ever loaded the page can call it with any body they like. So
 * each one re-derives the viewer, re-checks the capability, and re-validates the
 * payload from scratch. "The form would not have let me" constrains the form,
 * not the endpoint — and the form is not where the record is written.
 */

export type { ActionResult } from "@/lib/register/action-result.ts";

import type { ActionResult } from "@/lib/register/action-result.ts";
import { validatedColumns } from "@/lib/register/columns.ts";
import { isRecordVersion } from "@/lib/register/version.ts";

const BASE = "/students";

/**
 * References the record may legitimately hold, checked against this
 * institution's own data.
 *
 * `validation.ts` checks the *shape* of a lookup value because it must stay free
 * of the database — the form imports it. Lookup fields are suggestions, not
 * foreign keys: a clerk may enter a new faculty or degree before it is added
 * to the reference list. Supervisor ids are different: they are references
 * and must name a professor in *this* tenant, or a crafted request could
 * attach one university's professor to another university's student.
 *
 * Read inside the caller's transaction, so it is the same snapshot the write
 * uses and row-level security has already narrowed it to one institution.
 */

function payloadFrom(form: FormData): Record<string, string> {
  return Object.fromEntries(
    STUDENT_FIELDS.map((field) => [field.key, String(form.get(field.key) ?? "")]),
  );
}

/**
 * The validated payload, as columns.
 *
 * A cast, and the only one in this file. `studentSchema` is assembled from
 * `STUDENT_FIELDS` with `Object.fromEntries`, so its inferred type is
 * `Record<string, unknown>` — TypeScript cannot see that `studentNumber` is
 * among the keys, and drizzle therefore cannot see that the insert has the
 * columns it requires.
 *
 * What makes the cast safe is that every key comes from `STUDENT_FIELDS`, and
 * that every key in `STUDENT_FIELDS` is a real writable column is checked by a
 * test rather than asserted here — `fields.test.ts` compares the list against
 * the table definition. A typo in a field key would otherwise be invisible:
 * the column would simply never be written, and the value would vanish on save.
 */
function asColumns(data: Record<string, unknown>) {
  return validatedColumns<Omit<typeof students.$inferInsert, "tenantId">>(STUDENT_FIELDS, data);
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    // The first problem per field. A box showing three messages at once is a box
    // nobody reads, and fixing the first usually resolves the rest.
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/**
 * PostgreSQL's unique-violation code, turned into an error on the right box.
 *
 * The student number is unique per institution and the register is exactly where
 * two clerks collide. Reported as a general failure it reads as "the system is
 * broken"; reported on the field it reads as "this number is taken", which is
 * both true and actionable.
 */
function isDuplicateNumber(cause: unknown): boolean {
  /*
   * Walks the cause chain, because the database error arrives wrapped:
   * Drizzle rethrows its own query error with the PostgreSQL error as its
   * `cause`, and a top-only `code` check never sees the 23505 — the duplicate
   * became an unhandled server error and the clerk got the generic fault
   * screen instead of «این شماره قبلاً ثبت شده است». Found by the E2E suite.
   */
  let current: unknown = cause;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function createStudent(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("students.manage");

  const submitted = payloadFrom(form);
  const parsed = studentSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  let created: string | undefined;
  try {
    created = await withTenant(viewer.tenantId, async (tx) => {
      const errors = await collectReferenceErrors(tx, parsed.data);
      if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);

      const [row] = await tx
        .insert(students)
        .values({ ...asColumns(parsed.data), tenantId: viewer.tenantId })
        .returning({ id: students.id });
      if (!row) throw new Error("insert returned nothing");

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "create",
        entityType: "student",
        entityId: row.id,
      });

      return row.id;
    });
  } catch (cause) {
    if (cause instanceof ValidationFailure) {
      return { ok: false, errors: cause.errors, values: submitted };
    }
    if (isDuplicateNumber(cause)) {
      return { ok: false, errors: { studentNumber: "duplicate" }, values: submitted };
    }
    throw cause;
  }

  revalidatePath(BASE);
  /*
   * Outside the try, deliberately. `redirect` works by throwing, so called
   * inside one it is caught by the very handler meant for database faults and
   * re-thrown as an unexpected error.
   */
  redirect(`${BASE}/${created}`);
}

export async function updateStudent(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("students.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  if (!id || !isUuid(id) || !isRecordVersion(version)) {
    return { ok: false, message: "record.missing" };
  }

  const submitted = payloadFrom(form);
  const parsed = studentSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  try {
    const outcome = await withTenant(viewer.tenantId, async (tx) => {
      const [before] = await tx
        .select()
        .from(students)
        .where(and(eq(students.id, id), isNull(students.deletedAt)))
        .limit(1);
      if (!before) return "missing" as const;
      if (before.version !== version) return "conflict" as const;
      if (
        before.degree !== parsed.data.degree &&
        !viewer.capabilities.includes("students.degree")
      ) {
        return "degreeForbidden" as const;
      }
      const errors = await collectReferenceErrors(
        tx,
        parsed.data,
        before as Record<string, unknown>,
      );
      if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of STUDENT_FIELDS) {
        const from = before[field.key as keyof typeof before];
        const to = parsed.data[field.key as keyof typeof parsed.data];
        if (!same(field.kind, from, to)) changes[field.key] = { from, to };
      }

      /* A save with no semantic change is a real no-op. Advancing the version
         here would manufacture a conflict for somebody else even though this
         request changed no data at all. */
      if (Object.keys(changes).length === 0) return "unchanged" as const;

      /*
       * The version the form was rendered from has to still be the version in
       * the table.
       *
       * Two clerks open the same student, both save. Without this the second
       * write silently overwrites the first and neither of them ever learns
       * that the correction they made is gone. Matching on the version makes
       * the second write affect zero rows, which is a conflict this can report.
       */
      const updated = await tx
        .update(students)
        .set({ ...asColumns(parsed.data), version: version + 1, updatedAt: sql`now()` })
        .where(and(eq(students.id, id), eq(students.version, version), isNull(students.deletedAt)))
        .returning({ id: students.id });

      if (updated.length === 0) return "conflict" as const;

      /*
       * What actually changed, rather than the whole record.
       *
       * An audit entry holding fifty fields on every save is an audit trail
       * nobody can read — and the question it exists to answer is "who changed
       * this student's standing", which a diff answers and a snapshot buries.
       */
      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "student",
        entityId: id,
        changes: JSON.stringify(changes),
      });

      return "saved" as const;
    });

    if (outcome === "missing") return { ok: false, message: "record.missing", values: submitted };
    if (outcome === "conflict") return { ok: false, message: "record.conflict", values: submitted };
    if (outcome === "degreeForbidden")
      return { ok: false, message: "permission", values: submitted };
  } catch (cause) {
    if (cause instanceof ValidationFailure) {
      return { ok: false, errors: cause.errors, values: submitted };
    }
    if (isDuplicateNumber(cause)) {
      return { ok: false, errors: { studentNumber: "duplicate" }, values: submitted };
    }
    throw cause;
  }

  revalidatePath(BASE);
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}
export async function deleteStudents(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("students.manage");
  const ids = uuidList(form.getAll("id"), 1);
  const version = Number(form.get("version") ?? "");
  if (ids === null || ids.length !== 1 || !isRecordVersion(version)) {
    return { ok: false, message: "errors.bulk.selection" };
  }
  const [id] = ids;
  if (!id) return { ok: false, message: "errors.bulk.selection" };

  const removed = await withTenant(viewer.tenantId, async (tx) => {
    const retired = await tx
      .update(students)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(students.id, id), eq(students.version, version), isNull(students.deletedAt)))
      .returning({ id: students.id });

    if (retired.length === 0) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "delete",
      entityType: "student",
      entityId: id,
    });
    return true;
  });

  if (!removed) return { ok: false, message: "errors.record.conflict" };
  revalidatePath(BASE);
  return { ok: true };
}

export async function deleteStudent(
  previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const result = await deleteStudents(previous, form);
  if (!result.ok) return result;
  redirect(BASE);
}

/**
 * Whether a field is unchanged, compared the way that field's type requires.
 *
 * A `numeric` column comes back from PostgreSQL as a *string* carrying the
 * column's scale — `"17.50"` — while the parsed form value is the number
 * `17.5`. Compared as strings those differ, so every save recorded a GPA change
 * nobody had made: three spurious entries per record per save, in the one place
 * an office looks to find out who actually changed something. An audit trail
 * that logs non-changes is worse than none, because it trains people to skim it.
 *
 * So numbers are compared as numbers and everything else as text, with `null`
 * and `""` treated alike — an empty box and an unrecorded value are the same
 * state, and `validation.ts` stores both as `null`.
 */

/** Carries per-field errors out of a transaction without committing it. */
class ValidationFailure extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}
