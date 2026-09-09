"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { councilPermanentMembers, professors } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { hasDatabaseErrorCode } from "@/lib/db-errors.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { normalizePersianLetters } from "@/lib/register/validation.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

/**
 * Writing the council's standing roster.
 *
 * These are Server Actions, so they are public endpoints with generated names:
 * each re-derives the viewer and re-checks `council.manage` from scratch. That
 * the dialog is only rendered for somebody who may manage constrains the dialog,
 * not the endpoint.
 */

const MEETINGS = "/council-meetings";

class ValidationFailure extends Error {
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super("validation failed");
    this.errors = errors;
    this.name = "ValidationFailure";
  }
}

/** Adds a seat to the standing roster. */
export async function addRosterSeat(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("council.manage");

  /* Normalised on the way in, because the whole feature is a name match: a seat
     spelled with an Arabic yeh seeds an attendance list nothing else matches. */
  let memberName = normalizePersianLetters(String(form.get("memberName") ?? "").trim()).replace(
    /\s+/g,
    " ",
  );
  const professorId = String(form.get("professorId") ?? "").trim() || null;

  if (!memberName && !professorId) return { ok: false, errors: { memberName: "errors.required" } };
  if (memberName.length > 200) {
    return { ok: false, errors: { memberName: "errors.text.tooLong" } };
  }
  if (professorId && !isUuid(professorId)) {
    return { ok: false, errors: { professorId: "errors.record.missing" } };
  }

  try {
    await withTenant(viewer.tenantId, async (tx) => {
      if (professorId) {
        const [professor] = await tx
          .select({
            id: professors.id,
            firstName: professors.firstName,
            lastName: professors.lastName,
          })
          .from(professors)
          .where(and(eq(professors.id, professorId), isNull(professors.deletedAt)))
          .limit(1);
        if (!professor) throw new ValidationFailure({ professorId: "errors.record.missing" });
        /* A linked seat takes its spelling from the directory. The client also
           posts a name for progressive enhancement, but that text is not an
           authority: accepting a crafted different name would make the seat
           claim it links to one professor while displaying somebody else. */
        memberName = normalizePersianLetters(
          `${professor.firstName} ${professor.lastName}`.trim(),
        ).replace(/\s+/g, " ");
      }

      /*
       * Appended, not sorted alphabetically: the council's order is its own.
       * The order is allocated under a tenant-scoped transaction lock because
       * two clerks can add different seats at the same time; without the lock
       * both can observe the same MAX(sort_order) and create duplicate positions.
       */
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`council-roster:${viewer.tenantId}`}, 0))`,
      );

      const [last] = await tx
        .select({ highest: sql<number>`coalesce(max(sort_order), 0)`.mapWith(Number) })
        .from(councilPermanentMembers)
        .where(isNull(councilPermanentMembers.deletedAt));

      const [seat] = await tx
        .insert(councilPermanentMembers)
        .values({
          tenantId: viewer.tenantId,
          memberName,
          professorId,
          sortOrder: (last?.highest ?? 0) + 1,
        })
        .returning({ id: councilPermanentMembers.id });

      if (!seat) throw new Error("insert returned nothing");

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "create",
        entityType: "council_permanent_member",
        entityId: seat.id,
      });
    });
  } catch (cause) {
    if (cause instanceof ValidationFailure) {
      return { ok: false, errors: cause.errors };
    }
    /* Already seated. Reported on the box rather than as a general failure —
       "this name is already on the roster" is true and actionable. */
    if (hasDatabaseErrorCode(cause, "23505")) {
      return { ok: false, errors: { memberName: "council.roster.duplicate" } };
    }
    throw cause;
  }

  revalidatePath(MEETINGS);
  return { ok: true };
}

/** Retires a seat. The person stays in the directory; they stop being seated. */
export async function removeRosterSeat(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("council.manage");
  const id = String(form.get("id") ?? "");
  if (!id || !isUuid(id)) return { ok: false, message: "errors.record.missing" };

  const removed = await withTenant(viewer.tenantId, async (tx) => {
    const [seat] = await tx
      .update(councilPermanentMembers)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(councilPermanentMembers.id, id), isNull(councilPermanentMembers.deletedAt)))
      .returning({ id: councilPermanentMembers.id });

    if (!seat) return false;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "delete",
      entityType: "council_permanent_member",
      entityId: seat.id,
    });
    return true;
  });

  if (!removed) return { ok: false, message: "errors.record.missing" };
  revalidatePath(MEETINGS);
  return { ok: true };
}
