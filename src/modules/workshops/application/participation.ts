import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  lookups,
  workshopCertificates,
  workshopParticipants,
  workshopRegistrations,
  workshops,
} from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

const BASE = "/workshops";

class ValidationFailure extends Error {
  readonly errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}

/**
 * Marking who turned up.
 *
 * A single field on a single participant, because that is how the office uses
 * it: the register is open on a laptop in the room and somebody ticks names as
 * people arrive. A form that made them save the whole workshop to record one
 * arrival would be a form they stopped using.
 */
export async function setAttendance(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("workshops.view", "workshops.manage");

  const participantId = String(form.get("participantId") ?? "");
  const version = Number(form.get("version") ?? "");
  const status = String(form.get("status") ?? "");
  if (!participantId || !isUuid(participantId) || !isRecordVersion(version) || !status) {
    return { ok: false, message: "record.missing" };
  }

  let outcome: "updated" | "unchanged" | "missing" | "conflict" | "certified" = "missing";
  let changedWorkshopId: string | null = null;
  try {
    await withTenant(viewer.tenantId, async (tx) => {
      const known = await tx
        .select({ value: lookups.value })
        .from(lookups)
        .where(
          and(
            eq(lookups.set, "attendance_statuses"),
            eq(lookups.value, status),
            isNull(lookups.retiredAt),
          ),
        )
        .limit(1);
      if (known.length === 0) throw new ValidationFailure({ attendanceStatus: "lookup.unknown" });

      /* First learn which workshop owns the row, then take the same workshop
         lock certificate issuance takes. Attendance corrections and issuing
         certificates for this workshop therefore cannot interleave into an
         impossible "certificate for a non-attendee" state. */
      const [candidate] = await tx
        .select({ workshopId: workshopParticipants.workshopId })
        .from(workshopParticipants)
        .where(
          and(eq(workshopParticipants.id, participantId), isNull(workshopParticipants.deletedAt)),
        )
        .limit(1);
      if (!candidate) {
        outcome = "missing";
        return;
      }

      const workshop = await tx
        .select({ id: workshops.id })
        .from(workshops)
        .where(and(eq(workshops.id, candidate.workshopId), isNull(workshops.deletedAt)))
        .for("update");
      if (workshop.length === 0) {
        outcome = "missing";
        return;
      }
      changedWorkshopId = candidate.workshopId;

      const [before] = await tx
        .select({
          id: workshopParticipants.id,
          version: workshopParticipants.version,
          attendanceStatus: workshopParticipants.attendanceStatus,
        })
        .from(workshopParticipants)
        .where(
          and(eq(workshopParticipants.id, participantId), isNull(workshopParticipants.deletedAt)),
        )
        .limit(1);
      if (!before) {
        outcome = "missing";
        return;
      }
      if (before.version !== version) {
        outcome = "conflict";
        return;
      }
      if (before.attendanceStatus === status) {
        outcome = "unchanged";
        return;
      }

      if (status !== "attended") {
        const [certificate] = await tx
          .select({ id: workshopCertificates.id })
          .from(workshopCertificates)
          .where(
            and(
              eq(workshopCertificates.participantId, participantId),
              isNull(workshopCertificates.deletedAt),
            ),
          )
          .limit(1);
        if (certificate) {
          outcome = "certified";
          return;
        }
      }

      const rows = await tx
        .update(workshopParticipants)
        .set({ attendanceStatus: status, version: version + 1, updatedAt: sql`now()` })
        .where(
          and(
            eq(workshopParticipants.id, participantId),
            eq(workshopParticipants.version, version),
            isNull(workshopParticipants.deletedAt),
          ),
        )
        .returning({ id: workshopParticipants.id });

      if (rows.length === 0) {
        outcome = "conflict";
        return;
      }
      outcome = "updated";

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "update",
        entityType: "workshop_participant",
        entityId: participantId,
        changes: JSON.stringify({ attendanceStatus: { to: status } }),
      });

      /* Public-registration status follows the participant it created. The
         registration remains the durable intake record; the participant is the
         workshop roster entry. */
      await tx
        .update(workshopRegistrations)
        .set({
          status: status === "attended" ? "attended" : "approved",
          version: sql`${workshopRegistrations.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(workshopRegistrations.participantId, participantId),
            isNull(workshopRegistrations.deletedAt),
          ),
        );
    });
  } catch (cause) {
    if (cause instanceof ValidationFailure) {
      return { ok: false, errors: cause.errors };
    }
    throw cause;
  }

  if (outcome === "missing") return { ok: false, message: "record.missing" };
  if (outcome === "conflict") return { ok: false, message: "errors.record.conflict" };
  if (outcome === "certified") {
    return { ok: false, message: "workshops.certificateRequiresAttendance" };
  }

  if (outcome === "updated") {
    revalidatePath(BASE);
    if (changedWorkshopId) revalidatePath(`${BASE}/${changedWorkshopId}`);
  }
  return { ok: true };
}

const REGISTRATION_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  pending: new Set(["approved", "rejected", "cancelled"]),
  rejected: new Set(["pending"]),
  cancelled: new Set(["pending"]),
  approved: new Set(["cancelled"]),
  attended: new Set(),
};

/**
 * Administrative intake for public workshop registrations.
 *
 * Approval materialises exactly one roster participant and keeps a foreign-key
 * link back to the intake row. Reopening a rejected/cancelled request does not
 * create a participant; only approval does. Cancelling an already-attended or
 * certified participant is refused instead of silently rewriting history.
 */
export async function transitionWorkshopRegistration(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("workshops.view", "workshops.manage");
  const id = String(form.get("registrationId") ?? "");
  const version = Number(form.get("version") ?? "");
  const nextStatus = String(form.get("status") ?? "");
  if (!isUuid(id) || !isRecordVersion(version)) return { ok: false, message: "record.missing" };

  let workshopId: string | null = null;
  let outcome: "updated" | "missing" | "conflict" | "invalid" | "capacity" | "locked" = "missing";

  await withTenant(viewer.tenantId, async (tx) => {
    const [registration] = await tx
      .select({
        id: workshopRegistrations.id,
        workshopId: workshopRegistrations.workshopId,
        fullName: workshopRegistrations.fullName,
        phone: workshopRegistrations.phone,
        status: workshopRegistrations.status,
        participantId: workshopRegistrations.participantId,
        version: workshopRegistrations.version,
      })
      .from(workshopRegistrations)
      .where(and(eq(workshopRegistrations.id, id), isNull(workshopRegistrations.deletedAt)))
      .limit(1);
    if (!registration) return;
    workshopId = registration.workshopId;
    if (registration.version !== version) {
      outcome = "conflict";
      return;
    }
    if (registration.status === nextStatus) {
      outcome = "updated";
      return;
    }
    if (!(REGISTRATION_TRANSITIONS[registration.status] ?? new Set()).has(nextStatus)) {
      outcome = "invalid";
      return;
    }

    /* One lock serialises capacity decisions and roster materialisation. */
    const [workshop] = await tx
      .select({ id: workshops.id, capacity: workshops.capacity })
      .from(workshops)
      .where(and(eq(workshops.id, registration.workshopId), isNull(workshops.deletedAt)))
      .for("update");
    if (!workshop) return;

    let participantId = registration.participantId;
    if (nextStatus === "approved" && !participantId) {
      if (workshop.capacity > 0) {
        const [roster] = await tx
          .select({ total: sql<number>`count(*)`.mapWith(Number) })
          .from(workshopParticipants)
          .where(
            and(
              eq(workshopParticipants.workshopId, registration.workshopId),
              isNull(workshopParticipants.deletedAt),
            ),
          );
        if ((roster?.total ?? 0) >= workshop.capacity) {
          outcome = "capacity";
          return;
        }
      }
      const [participant] = await tx
        .insert(workshopParticipants)
        .values({
          tenantId: viewer.tenantId,
          workshopId: registration.workshopId,
          externalName: registration.fullName,
          externalMobile: registration.phone,
          registrationDate: sql`current_date`,
          attendanceStatus: "registered",
          paymentStatus: "free",
        })
        .returning({ id: workshopParticipants.id });
      if (!participant) throw new Error("failed to materialise workshop participant");
      participantId = participant.id;
    }

    if (nextStatus === "cancelled" && participantId) {
      const [participant] = await tx
        .select({ attendanceStatus: workshopParticipants.attendanceStatus })
        .from(workshopParticipants)
        .where(
          and(eq(workshopParticipants.id, participantId), isNull(workshopParticipants.deletedAt)),
        )
        .limit(1);
      const [certificate] = await tx
        .select({ id: workshopCertificates.id })
        .from(workshopCertificates)
        .where(
          and(
            eq(workshopCertificates.participantId, participantId),
            isNull(workshopCertificates.deletedAt),
          ),
        )
        .limit(1);
      if (participant?.attendanceStatus === "attended" || certificate) {
        outcome = "locked";
        return;
      }
      await tx
        .update(workshopParticipants)
        .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(eq(workshopParticipants.id, participantId), isNull(workshopParticipants.deletedAt)),
        );
      participantId = null;
    }

    const changed = await tx
      .update(workshopRegistrations)
      .set({
        status: nextStatus,
        participantId,
        approvedBy:
          nextStatus === "approved"
            ? viewer.userId
            : registration.status === "approved"
              ? null
              : undefined,
        approvedAt:
          nextStatus === "approved"
            ? sql`now()`
            : registration.status === "approved"
              ? null
              : undefined,
        version: version + 1,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(workshopRegistrations.id, id),
          eq(workshopRegistrations.version, version),
          isNull(workshopRegistrations.deletedAt),
        ),
      )
      .returning({ id: workshopRegistrations.id });
    if (changed.length === 0) {
      outcome = "conflict";
      return;
    }

    outcome = "updated";
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "workshop_registration.transition",
      entityType: "workshop_registration",
      entityId: id,
      changes: JSON.stringify({
        status: { from: registration.status, to: nextStatus },
        participantId,
      }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type:
        nextStatus === "approved"
          ? "WorkshopRegistrationApproved"
          : "WorkshopRegistrationStatusChanged",
      aggregateType: "workshop_registration",
      aggregateId: id,
      payload: { workshopId: registration.workshopId, status: nextStatus, participantId },
    });
  });

  if (outcome === "missing") return { ok: false, message: "record.missing" };
  if (outcome === "conflict") return { ok: false, message: "errors.record.conflict" };
  if (outcome === "invalid")
    return { ok: false, message: "workshops.registrationInvalidTransition" };
  if (outcome === "capacity")
    return { ok: false, message: "workshops.registrationCapacityReached" };
  if (outcome === "locked") return { ok: false, message: "workshops.registrationAlreadyAttended" };
  revalidatePath(BASE);
  if (workshopId) revalidatePath(`${BASE}/${workshopId}`);
  return { ok: true };
}
