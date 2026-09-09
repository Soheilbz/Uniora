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
import { councilDecisions, councilMeetings } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { same, sameJson } from "@/lib/register/changes.ts";
import { schemaFor } from "@/lib/register/validation.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { DECISION_FIELDS, MEETING_FIELDS } from "../fields.ts";
import {
  asDecision,
  asMeeting,
  assertMeetingReference,
  duplicateSeats,
  fieldErrorsFrom,
  isDuplicate,
  MissingReference,
  namesFrom,
  payloadFrom,
  substitutionsFrom,
  unknownLookups,
  ValidationFailure,
} from "./use-case-helpers.ts";

export { deleteDecisions, deleteMeetings } from "./retire-use-cases.ts";

/**
 * Writing the council's records.
 *
 * Every one of these is a public endpoint — a Server Action compiles to an HTTP
 * route with a generated name, and anybody who has loaded the page can call it
 * with any body. So each re-derives the viewer, re-checks the capability, and
 * re-validates from scratch. "The form would not have let me" constrains the
 * form, not the endpoint.
 */

const MEETINGS = "/council-meetings";
const DECISIONS = "/council-decisions";

/* ── Sittings ─────────────────────────────────────────────────────────────── */

const meetingSchema = schemaFor(MEETING_FIELDS);

export async function saveMeeting(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("council.view", "council.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  if (id && (!isUuid(id) || !isRecordVersion(version))) {
    return { ok: false, message: "record.missing" };
  }

  const submitted = payloadFrom(MEETING_FIELDS, form);
  const parsed = meetingSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  const substitutions = substitutionsFrom(form);
  if (substitutions === null) {
    return {
      ok: false,
      errors: { absentees: "attendance.invalidSubstitutions" },
      values: submitted,
    };
  }

  const participants = namesFrom(form, "participants");
  const absentees = namesFrom(form, "absentees");
  if (participants === null || absentees === null) {
    return {
      ok: false,
      errors: { absentees: "attendance.invalidNames" },
      values: submitted,
    };
  }

  const values: Record<string, unknown> & {
    participants: string[];
    absentees: string[];
    substitutions: Record<string, string>;
  } = {
    ...(parsed.data as Record<string, unknown>),
    participants,
    absentees,
    substitutions,
  };

  /*
   * A name on both lists is a contradiction, not a preference.
   *
   * Somebody moved to «غایبان» whose name was never removed from «حاضران»
   * produces a minute that records them as having both attended and not, and
   * the attendance count on the register then adds up to more than the council
   * has members.
   */
  const onBoth = values.participants.filter((name) => values.absentees.includes(name));
  if (onBoth.length > 0) {
    return { ok: false, errors: { absentees: "attendance.onBothLists" }, values: submitted };
  }

  const absent = new Set(values.absentees);
  const invalidSubstitution = Object.keys(substitutions).some((member) => !absent.has(member));
  if (invalidSubstitution) {
    return {
      ok: false,
      errors: { absentees: "attendance.invalidSubstitutions" },
      values: submitted,
    };
  }

  let saved: string | undefined;
  try {
    saved = await withTenant(viewer.tenantId, async (tx) => {
      if (!id) {
        const errors = await unknownLookups(tx, MEETING_FIELDS, values);
        if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);
        const [row] = await tx
          .insert(councilMeetings)
          .values({ ...asMeeting(values), tenantId: viewer.tenantId })
          .returning({ id: councilMeetings.id });
        if (!row) throw new Error("insert returned nothing");

        await writeAuditEvent(tx, {
          tenantId: viewer.tenantId,
          actorId: viewer.userId,
          action: "create",
          entityType: "council_meeting",
          entityId: row.id,
        });
        return row.id;
      }

      const [before] = await tx
        .select()
        .from(councilMeetings)
        .where(and(eq(councilMeetings.id, id), isNull(councilMeetings.deletedAt)))
        .limit(1);
      if (!before) throw new MissingReference();
      if (before.version !== version) throw new ValidationFailure({});
      const lookupErrors = await unknownLookups(
        tx,
        MEETING_FIELDS,
        values,
        before as Record<string, unknown>,
      );
      if (Object.keys(lookupErrors).length > 0) throw new ValidationFailure(lookupErrors);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of MEETING_FIELDS) {
        const from = (before as Record<string, unknown>)[field.key] ?? null;
        const to = values[field.key] ?? null;
        const equal =
          field.key === "participants" || field.key === "absentees"
            ? sameJson(from, to)
            : same(field.kind, from, to);
        if (!equal) changes[field.key] = { from, to };
      }
      if (!sameJson(before.substitutions ?? {}, substitutions)) {
        changes.substitutions = { from: before.substitutions ?? {}, to: substitutions };
      }
      if (Object.keys(changes).length === 0) return id;

      const updated = await tx
        .update(councilMeetings)
        .set({ ...asMeeting(values), version: version + 1, updatedAt: sql`now()` })
        .where(
          and(
            eq(councilMeetings.id, id),
            eq(councilMeetings.version, version),
            isNull(councilMeetings.deletedAt),
          ),
        )
        .returning({ id: councilMeetings.id });

      // Zero rows means the version moved: somebody else saved between this
      // form being drawn and being submitted. Reported, never overwritten.
      if (updated.length === 0) throw new ValidationFailure({});

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "council_meeting",
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
    if (isDuplicate(cause)) {
      return { ok: false, errors: { meetingNumber: "duplicate" }, values: submitted };
    }
    throw cause;
  }

  revalidatePath(MEETINGS);
  redirect(`${MEETINGS}/${saved}`);
}

/* ── Decisions ────────────────────────────────────────────────────────────── */

const decisionSchema = schemaFor(DECISION_FIELDS);

const ALL_SEATS = [
  "primarySupervisor",
  "secondarySupervisor",
  "thirdSupervisor",
  "firstAdvisor",
  "secondAdvisor",
  "thirdAdvisor",
  "reviewer1",
  "reviewer2",
  "reviewer3",
  "reviewer4Invited",
] as const;

export async function saveDecision(
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

  const submitted = payloadFrom(DECISION_FIELDS, form);
  const parsed = decisionSchema.safeParse(submitted);
  if (!parsed.success) {
    return { ok: false, errors: fieldErrorsFrom(parsed.error.issues), values: submitted };
  }

  const values = parsed.data as Record<string, unknown>;
  const seatErrors = duplicateSeats(values, ALL_SEATS);
  if (Object.keys(seatErrors).length > 0) {
    return { ok: false, errors: seatErrors, values: submitted };
  }

  let saved: string | undefined;
  try {
    saved = await withTenant(viewer.tenantId, async (tx) => {
      await assertMeetingReference(tx, meetingId);

      const row = { ...asDecision(values), meetingId, tenantId: viewer.tenantId };

      if (!id) {
        const errors = await unknownLookups(tx, DECISION_FIELDS, values);
        if (Object.keys(errors).length > 0) throw new ValidationFailure(errors);
        const [created] = await tx
          .insert(councilDecisions)
          .values(row)
          .returning({ id: councilDecisions.id });
        if (!created) throw new Error("insert returned nothing");

        await writeAuditEvent(tx, {
          tenantId: viewer.tenantId,
          actorId: viewer.userId,
          action: "create",
          entityType: "council_decision",
          entityId: created.id,
        });
        return created.id;
      }

      const [before] = await tx
        .select()
        .from(councilDecisions)
        .where(and(eq(councilDecisions.id, id), isNull(councilDecisions.deletedAt)))
        .limit(1);
      if (!before) throw new MissingReference();
      if (before.version !== version) throw new ValidationFailure({});
      const lookupErrors = await unknownLookups(
        tx,
        DECISION_FIELDS,
        values,
        before as Record<string, unknown>,
      );
      if (Object.keys(lookupErrors).length > 0) throw new ValidationFailure(lookupErrors);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of DECISION_FIELDS) {
        const from = (before as Record<string, unknown>)[field.key] ?? null;
        const to = values[field.key] ?? null;
        if (!same(field.kind, from, to)) changes[field.key] = { from, to };
      }
      if (!same("text", before.meetingId, meetingId)) {
        changes.meetingId = { from: before.meetingId, to: meetingId };
      }
      if (Object.keys(changes).length === 0) return id;

      const updated = await tx
        .update(councilDecisions)
        .set({ ...asDecision(values), meetingId, version: version + 1, updatedAt: sql`now()` })
        .where(
          and(
            eq(councilDecisions.id, id),
            eq(councilDecisions.version, version),
            isNull(councilDecisions.deletedAt),
          ),
        )
        .returning({ id: councilDecisions.id });

      if (updated.length === 0) throw new ValidationFailure({});

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "council_decision",
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

  revalidatePath(DECISIONS);
  redirect(`${DECISIONS}/${saved}`);
}
