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
import { workshops } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { currentLookupErrors } from "@/lib/lookup-validation.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { same } from "@/lib/register/changes.ts";
import { validatedColumns } from "@/lib/register/columns.ts";
import type { AnyFieldSpec } from "@/lib/register/field-spec.ts";
import { schemaFor } from "@/lib/register/validation.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid, uuidList } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { WORKSHOP_FIELDS } from "../model.ts";

/**
 * Writing workshops, their enrolment, and the certificates they issue.
 *
 * Every one is a public endpoint — see the council's actions for why each
 * re-derives the viewer, re-checks the capability and re-validates the payload.
 */

const BASE = "/workshops";

class ValidationFailure extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}

class MissingRecord extends Error {}

const workshopSchema = schemaFor(WORKSHOP_FIELDS);

function payloadFrom(fields: readonly AnyFieldSpec[], form: FormData): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, String(form.get(field.key) ?? "")]));
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function asWorkshop(values: Record<string, unknown>) {
  return validatedColumns<Omit<typeof workshops.$inferInsert, "tenantId">>(WORKSHOP_FIELDS, values);
}

export async function saveWorkshop(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("workshops.view", "workshops.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  if (id && (!isUuid(id) || !isRecordVersion(version))) {
    return { ok: false, message: "record.missing" };
  }

  const submitted = payloadFrom(WORKSHOP_FIELDS, form);
  const parsed = workshopSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  const values = parsed.data as Record<string, unknown>;
  /*
   * Columns the schema declares NOT NULL with a default: a blank form value
   * means the default, never an explicit NULL — which the column refuses and
   * a form whose only required field is the title cannot afford. The schema's
   * own comments state both meanings: capacity zero is «no limit was set»,
   * and a workshop nobody has classified yet is «planned».
   */
  if (values.capacity === null || values.capacity === undefined) values.capacity = 0;
  if (values.status === null || values.status === undefined) values.status = "planned";

  let saved: string | undefined;
  try {
    saved = await withTenant(viewer.tenantId, async (tx) => {
      if (!id) {
        const errors = await currentLookupErrors(tx, WORKSHOP_FIELDS, values);
        if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);
        const [created] = await tx
          .insert(workshops)
          .values({ ...asWorkshop(values), tenantId: viewer.tenantId })
          .returning({ id: workshops.id });
        if (!created) throw new Error("insert returned nothing");

        await writeAuditEvent(tx, {
          tenantId: viewer.tenantId,
          actorId: viewer.userId,
          action: "create",
          entityType: "workshop",
          entityId: created.id,
        });
        return created.id;
      }

      const [before] = await tx
        .select()
        .from(workshops)
        .where(and(eq(workshops.id, id), isNull(workshops.deletedAt)))
        .limit(1);
      if (!before) throw new MissingRecord();
      if (before.version !== version) throw new ValidationFailure({});
      const lookupErrors = await currentLookupErrors(
        tx,
        WORKSHOP_FIELDS,
        values,
        before as Record<string, unknown>,
      );
      if (Object.keys(lookupErrors).length > 0) throw new ValidationFailure(lookupErrors);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of WORKSHOP_FIELDS) {
        const from = (before as Record<string, unknown>)[field.key] ?? null;
        const to = values[field.key] ?? null;
        if (!same(field.kind, from, to)) changes[field.key] = { from, to };
      }
      if (Object.keys(changes).length === 0) return id;

      const updated = await tx
        .update(workshops)
        .set({ ...asWorkshop(values), version: version + 1, updatedAt: sql`now()` })
        .where(
          and(eq(workshops.id, id), eq(workshops.version, version), isNull(workshops.deletedAt)),
        )
        .returning({ id: workshops.id });

      if (updated.length === 0) throw new ValidationFailure({});

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "workshop",
        entityId: id,
        changes: JSON.stringify(changes),
      });
      return id;
    });
  } catch (cause) {
    if (cause instanceof MissingRecord) {
      return { ok: false, message: "record.missing", values: submitted };
    }
    if (cause instanceof ValidationFailure) {
      return Object.keys(cause.errors).length > 0
        ? { ok: false, errors: cause.errors, values: submitted }
        : { ok: false, message: "record.conflict", values: submitted };
    }
    throw cause;
  }

  revalidatePath(BASE);
  redirect(`${BASE}/${saved}`);
}
export async function deleteWorkshops(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const ids = uuidList(form.getAll("id"), 1);
  const version = Number(form.get("version") ?? "");
  if (ids === null || ids.length !== 1 || !isRecordVersion(version)) {
    return { ok: false, message: "errors.bulk.selection" };
  }
  const [id] = ids;
  if (!id) return { ok: false, message: "errors.bulk.selection" };

  const removed = await withTenant(viewer.tenantId, async (tx) => {
    const retired = await tx
      .update(workshops)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(workshops.id, id), eq(workshops.version, version), isNull(workshops.deletedAt)))
      .returning({ id: workshops.id });
    if (retired.length === 0) return false;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "delete",
      entityType: "workshop",
      entityId: id,
    });
    return true;
  });

  if (!removed) return { ok: false, message: "errors.record.conflict" };
  revalidatePath(BASE);
  return { ok: true };
}
