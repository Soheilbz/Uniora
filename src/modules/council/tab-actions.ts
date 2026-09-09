"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  councilAppointments,
  councilMeetings,
  councilRulings,
  decisionTemplateVersions,
  professors,
} from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { currentLookupErrors } from "@/lib/lookup-validation.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { same } from "@/lib/register/changes.ts";
import { validatedColumns } from "@/lib/register/columns.ts";
import { schemaFor } from "@/lib/register/validation.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid, uuidList } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import {
  APPOINTMENT_FIELDS,
  APPOINTMENT_SEATS,
  type CouncilField,
  RULING_FIELDS,
} from "./fields.ts";

/**
 * Writing the decisions screen's other two registers.
 *
 * Separate from `actions.ts` for the same reason `registers.ts` is separate from
 * `queries.ts` — one file per pair of tables rather than one file of six exports
 * — and under the same rules: each re-derives the viewer, re-checks the
 * capability, and re-validates the payload, because a Server Action is a public
 * endpoint and the form is not what writes the record.
 */

const BASE = "/council-decisions";

class ValidationFailure extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}

class MissingReference extends Error {
  constructor() {
    super("missing reference");
    this.name = "MissingReference";
  }
}

async function assertMeetingReference(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  meetingId: string | null,
) {
  if (!meetingId) return;
  const [meeting] = await tx
    .select({ id: councilMeetings.id })
    .from(councilMeetings)
    .where(eq(councilMeetings.id, meetingId))
    .limit(1);
  if (!meeting) throw new MissingReference();
}

function payloadFrom(fields: readonly CouncilField[], form: FormData): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, String(form.get(field.key) ?? "")]));
}

/**
 * The validated payload, as columns.
 *
 * Casts, for the reason the other actions file records: a schema assembled with
 * `Object.fromEntries` infers as `Record<string, unknown>`, so drizzle cannot
 * see the columns it requires. What makes them safe is that every key comes from
 * a field list, and `fields.test.ts` checks those against the table definitions.
 */
function asRuling(values: Record<string, unknown>) {
  return validatedColumns<Omit<typeof councilRulings.$inferInsert, "tenantId">>(
    RULING_FIELDS,
    values,
  );
}

function asAppointment(values: Record<string, unknown>) {
  return validatedColumns<Omit<typeof councilAppointments.$inferInsert, "tenantId">>(
    APPOINTMENT_FIELDS,
    values,
  );
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

async function unknownLookups(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  fields: readonly CouncilField[],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<Record<string, string>> {
  return currentLookupErrors(tx, fields, values, before);
}

async function appointmentReferenceErrors(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const ids = APPOINTMENT_SEATS.map((seat) => values[seat]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (ids.length === 0) return {};

  const found = await tx
    .select({ id: professors.id })
    .from(professors)
    .where(and(inArray(professors.id, ids), isNull(professors.deletedAt)));
  const current = new Set(found.map((row) => row.id));
  const errors: Record<string, string> = {};
  for (const seat of APPOINTMENT_SEATS) {
    const value = values[seat];
    if (typeof value !== "string" || !value || current.has(value)) continue;
    if (before && String(before[seat] ?? "") === value) continue;
    errors[seat] = "reference.unknown";
  }
  return errors;
}

/* ── Rulings ──────────────────────────────────────────────────────────────── */

const rulingSchema = schemaFor(RULING_FIELDS);

export async function saveRuling(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("council.view", "council.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  const meetingId = String(form.get("meetingId") ?? "") || null;
  const templateVersionId = String(form.get("templateVersionId") ?? "") || null;
  const submittedTemplateId = String(form.get("templateId") ?? "").trim();
  const templateId = submittedTemplateId ? submittedTemplateId.replace(/@v\d+$/, "") : null;
  if (id && (!isUuid(id) || !isRecordVersion(version))) {
    return { ok: false, message: "record.missing" };
  }
  if (meetingId && !isUuid(meetingId)) return { ok: false, message: "record.missing" };
  if (templateVersionId && !isUuid(templateVersionId))
    return { ok: false, message: "record.missing" };

  const submitted = payloadFrom(RULING_FIELDS, form);
  const parsed = rulingSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  const values = parsed.data as Record<string, unknown>;

  let saved: string | undefined;
  try {
    saved = await withTenant(viewer.tenantId, async (tx) => {
      await assertMeetingReference(tx, meetingId);
      if (templateVersionId) {
        const [template] = await tx
          .select({ id: decisionTemplateVersions.id })
          .from(decisionTemplateVersions)
          .where(
            and(
              eq(decisionTemplateVersions.id, templateVersionId),
              eq(decisionTemplateVersions.status, "published"),
            ),
          )
          .limit(1);
        if (!template) throw new MissingReference();
      }

      const row = { ...asRuling(values), meetingId, templateId, templateVersionId };

      if (!id) {
        const errors = await unknownLookups(tx, RULING_FIELDS, values);
        if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);
        const [created] = await tx
          .insert(councilRulings)
          .values({ ...row, tenantId: viewer.tenantId })
          .returning({ id: councilRulings.id });
        if (!created) throw new Error("insert returned nothing");

        await writeAuditEvent(tx, {
          tenantId: viewer.tenantId,
          actorId: viewer.userId,
          action: "create",
          entityType: "council_ruling",
          entityId: created.id,
        });
        return created.id;
      }

      const [before] = await tx
        .select()
        .from(councilRulings)
        .where(and(eq(councilRulings.id, id), isNull(councilRulings.deletedAt)))
        .limit(1);
      if (!before) throw new MissingReference();
      if (before.version !== version) throw new ValidationFailure({});
      const lookupErrors = await unknownLookups(
        tx,
        RULING_FIELDS,
        values,
        before as Record<string, unknown>,
      );
      if (Object.keys(lookupErrors).length > 0) throw new ValidationFailure(lookupErrors);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of RULING_FIELDS) {
        const from = (before as Record<string, unknown>)[field.key] ?? null;
        const to = values[field.key] ?? null;
        if (!same(field.kind, from, to)) changes[field.key] = { from, to };
      }
      if (!same("text", before.meetingId, meetingId)) {
        changes.meetingId = { from: before.meetingId, to: meetingId };
      }
      if (!same("text", before.templateId, templateId)) {
        changes.templateId = { from: before.templateId, to: templateId };
      }
      if (!same("text", before.templateVersionId, templateVersionId)) {
        changes.templateVersionId = { from: before.templateVersionId, to: templateVersionId };
      }
      if (Object.keys(changes).length === 0) return id;

      const updated = await tx
        .update(councilRulings)
        .set({ ...row, version: version + 1, updatedAt: sql`now()` })
        .where(
          and(
            eq(councilRulings.id, id),
            eq(councilRulings.version, version),
            isNull(councilRulings.deletedAt),
          ),
        )
        .returning({ id: councilRulings.id });

      // Zero rows means the version moved between this form being drawn and
      // being submitted. Reported, never overwritten.
      if (updated.length === 0) throw new ValidationFailure({});

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "council_ruling",
        entityId: id,
        changes: JSON.stringify(changes),
      });
      return id;
    });
  } catch (cause) {
    if (cause instanceof MissingReference) {
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
  redirect(`${BASE}/rulings/${saved}`);
}

/* ── Appointments ─────────────────────────────────────────────────────────── */

const appointmentSchema = schemaFor(APPOINTMENT_FIELDS);

export async function saveAppointment(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("council.view", "council.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  const meetingId = String(form.get("meetingId") ?? "") || null;
  if (id && (!isUuid(id) || !isRecordVersion(version))) {
    return { ok: false, message: "record.missing" };
  }
  if (meetingId && !isUuid(meetingId)) return { ok: false, message: "record.missing" };

  const submitted = payloadFrom(APPOINTMENT_FIELDS, form);
  const parsed = appointmentSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  const values = parsed.data as Record<string, unknown>;

  /*
   * The same professor cannot hold two of the three chairs.
   *
   * Unlike the decision's board — which is free text and folded before
   * comparing — these are ids, so the collision is exact. It is still a real
   * mistake: three near-identical selects, and a clerk picks the same name into
   * two of them, producing an appointment the capacity report counts twice
   * against that professor's load.
   */
  const seatErrors: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const seat of APPOINTMENT_SEATS) {
    const value = values[seat];
    if (typeof value !== "string" || !value) continue;
    if (seen.has(value)) seatErrors[seat] = "seat.duplicate";
    else seen.set(value, seat);
  }
  if (Object.keys(seatErrors).length > 0) {
    return { ok: false, errors: seatErrors, values: submitted };
  }

  let saved: string | undefined;
  try {
    saved = await withTenant(viewer.tenantId, async (tx) => {
      const errors: Record<string, string> = {};
      await assertMeetingReference(tx, meetingId);

      const row = { ...asAppointment(values), meetingId };

      if (!id) {
        Object.assign(errors, await unknownLookups(tx, APPOINTMENT_FIELDS, values));
        Object.assign(errors, await appointmentReferenceErrors(tx, values));
        if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);
        const [created] = await tx
          .insert(councilAppointments)
          .values({ ...row, tenantId: viewer.tenantId })
          .returning({ id: councilAppointments.id });
        if (!created) throw new Error("insert returned nothing");

        await writeAuditEvent(tx, {
          tenantId: viewer.tenantId,
          actorId: viewer.userId,
          action: "create",
          entityType: "council_appointment",
          entityId: created.id,
        });
        return created.id;
      }

      const [before] = await tx
        .select()
        .from(councilAppointments)
        .where(and(eq(councilAppointments.id, id), isNull(councilAppointments.deletedAt)))
        .limit(1);
      if (!before) throw new MissingReference();
      if (before.version !== version) throw new ValidationFailure({});
      const lookupErrors = await unknownLookups(
        tx,
        APPOINTMENT_FIELDS,
        values,
        before as Record<string, unknown>,
      );
      Object.assign(
        lookupErrors,
        await appointmentReferenceErrors(tx, values, before as Record<string, unknown>),
      );
      if (Object.keys(lookupErrors).length > 0) throw new ValidationFailure(lookupErrors);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of APPOINTMENT_FIELDS) {
        const from = (before as Record<string, unknown>)[field.key] ?? null;
        const to = values[field.key] ?? null;
        if (!same(field.kind, from, to)) changes[field.key] = { from, to };
      }
      if (!same("text", before.meetingId, meetingId)) {
        changes.meetingId = { from: before.meetingId, to: meetingId };
      }
      if (Object.keys(changes).length === 0) return id;

      const updated = await tx
        .update(councilAppointments)
        .set({ ...row, version: version + 1, updatedAt: sql`now()` })
        .where(
          and(
            eq(councilAppointments.id, id),
            eq(councilAppointments.version, version),
            isNull(councilAppointments.deletedAt),
          ),
        )
        .returning({ id: councilAppointments.id });

      if (updated.length === 0) throw new ValidationFailure({});

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "council_appointment",
        entityId: id,
        changes: JSON.stringify(changes),
      });
      return id;
    });
  } catch (cause) {
    if (cause instanceof MissingReference) {
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
  redirect(`${BASE}/appointments/${saved}`);
}
async function retire(
  table: typeof councilRulings | typeof councilAppointments,
  entityType: string,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("council.view", "council.manage");
  const ids = uuidList(form.getAll("id"), 1);
  const version = Number(form.get("version") ?? "");
  if (ids === null || ids.length !== 1 || !isRecordVersion(version)) {
    return { ok: false, message: "errors.bulk.selection" };
  }
  const [id] = ids;
  if (!id) return { ok: false, message: "errors.bulk.selection" };

  const removed = await withTenant(viewer.tenantId, async (tx) => {
    const retired = await tx
      .update(table)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(table.id, id), eq(table.version, version), isNull(table.deletedAt)))
      .returning({ id: table.id });
    if (retired.length === 0) return false;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "delete",
      entityType,
      entityId: id,
    });
    return true;
  });

  if (!removed) return { ok: false, message: "errors.record.conflict" };
  revalidatePath(BASE);
  return { ok: true };
}

export async function deleteRulings(_previous: ActionResult | null, form: FormData) {
  return retire(councilRulings, "council_ruling", form);
}

export async function deleteAppointments(_previous: ActionResult | null, form: FormData) {
  return retire(councilAppointments, "council_appointment", form);
}
