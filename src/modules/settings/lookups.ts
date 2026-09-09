"use server";

import { and, eq, not, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { lookups } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { isClosedSet, isRequiredValue } from "@/db/vocabulary.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { hasDatabaseErrorCode } from "@/lib/db-errors.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

/**
 * The institution's own vocabularies: faculties, degrees, statuses, weekdays.
 *
 * ── What may change and what may not ────────────────────────────────────────
 *
 * A label may always be corrected. A *value* may never be, once it exists: it
 * is what the records themselves store, so renaming `phd` to `doctorate` would
 * not update four hundred students — it would orphan them, and every one of
 * their screens would fall back to printing the bare key. The form locks it
 * after creation, and this refuses it again, because a locked input is a
 * courtesy and the check is the control.
 *
 * ── Retiring rather than deleting ───────────────────────────────────────────
 *
 * An entry the office has stopped offering must vanish from the forms and stay
 * legible on the records already filed under it. That is exactly what
 * `retiredAt` does — `optionsFor` drops a retired entry, `lookupTable` keeps
 * it — so retiring is the ordinary action here and deleting is refused
 * outright for anything in use.
 */

/** A stored value: lowercase, ASCII, and stable. */
const VALUE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export async function addLookupEntry(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("lookups.manage");

  const set = String(form.get("set") ?? "").trim();
  const value = String(form.get("value") ?? "").trim();
  const label = String(form.get("label") ?? "").trim();
  const submitted = { set, value, label };

  const errors: Record<string, string> = {};
  if (set === "") errors.set = "required";
  if (!VALUE_PATTERN.test(value)) errors.value = "setKeyInvalid";
  if (label === "") errors.label = "required";
  if (label.length > 200) errors.label = "tooLong";
  /*
   * A closed set takes no additions — see `CODE_OWNED` in `db/vocabulary.ts`.
   *
   * The program enumerates these exhaustively and has no default branch, so a
   * sixth report category is not a sixth option: it is decisions that appear in
   * no section of the minute and have no worksheet, silently. The screen hides
   * the button too; this is the check that matters, because a Server Action is
   * a public endpoint and "the form would not have let me" is not a constraint.
   */
  if (isClosedSet(set)) errors.set = "setClosed";
  if (Object.keys(errors).length > 0) return { ok: false, errors, values: submitted };

  let taken: boolean;
  try {
    taken = await withTenant(viewer.tenantId, async (tx) => {
      /* Position allocation is a per-tenant, per-set sequence. Serialise adds
         with reordering so two concurrent inserts cannot both observe the same
         MAX(position) and create an accidental tie. */
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${viewer.tenantId}:lookup:${set}`}, 0))`,
      );
      const existing = await tx
        .select({ id: lookups.id })
        .from(lookups)
        .where(and(eq(lookups.set, set), eq(lookups.value, value)))
        .limit(1);
      if (existing.length > 0) return true;

      /* Appended, not inserted at the top: an office adding «دکتری پیوسته» to a
         degree list expects it after the degrees already there. */
      const [last] = await tx
        .select({ highest: sql<number>`coalesce(max(${lookups.position}), -1)`.mapWith(Number) })
        .from(lookups)
        .where(eq(lookups.set, set));

      await tx.insert(lookups).values({
        tenantId: viewer.tenantId,
        set,
        value,
        label,
        position: (last?.highest ?? -1) + 1,
      });

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "lookups.value.create",
        entityType: "lookup",
        entityId: `${set}:${value}`,
        changes: JSON.stringify({ label: { from: null, to: label } }),
      });

      return false;
    });
  } catch (cause) {
    if (hasDatabaseErrorCode(cause, "23505")) taken = true;
    else throw cause;
  }

  if (taken) return { ok: false, errors: { value: "duplicate" }, values: submitted };

  revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}

/**
 * Correcting a label.
 *
 * The label only. The value is what the records hold and is refused here even
 * though the form does not offer it — a Server Action is a public endpoint, and
 * the fact that this application's own form locks the field is not a check.
 */
export async function renameLookupEntry(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("lookups.manage");

  const id = String(form.get("id") ?? "");
  const label = String(form.get("label") ?? "").trim();
  if (id === "" || !isUuid(id)) return { ok: false, message: "saveFailed" };
  if (label === "") return { ok: false, errors: { label: "required" } };
  if (label.length > 200) return { ok: false, errors: { label: "tooLong" } };

  const outcome = await withTenant(viewer.tenantId, async (tx) => {
    const [before] = await tx
      .select({ set: lookups.set, value: lookups.value, label: lookups.label })
      .from(lookups)
      .where(eq(lookups.id, id))
      .limit(1);
    if (!before) return "missing" as const;
    if (before.label === label) return "unchanged" as const;

    const [updated] = await tx
      .update(lookups)
      .set({ label, updatedAt: sql`now()` })
      .where(eq(lookups.id, id))
      .returning({ id: lookups.id });
    if (!updated) return "missing" as const;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "lookups.value.update",
      entityType: "lookup",
      entityId: `${before.set}:${before.value}`,
      changes: JSON.stringify({ label: { from: before.label, to: label } }),
    });
    return "changed" as const;
  });

  if (outcome === "missing") return { ok: false, message: "record.missing" };
  if (outcome === "changed") revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}

/** Withdrawing an entry from the forms, or offering it again. */
export async function setLookupRetired(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("lookups.manage");

  const id = String(form.get("id") ?? "");
  const retiredValue = String(form.get("retired") ?? "");
  if (id === "" || !isUuid(id) || (retiredValue !== "0" && retiredValue !== "1")) {
    return { ok: false, message: "saveFailed" };
  }
  const retired = retiredValue === "1";

  const outcome = await withTenant(viewer.tenantId, async (tx) => {
    const [before] = await tx
      .select({ set: lookups.set, value: lookups.value, retiredAt: lookups.retiredAt })
      .from(lookups)
      .where(eq(lookups.id, id))
      .limit(1);
    if (!before) return "missing" as const;

    /*
     * A value the program branches on cannot be withdrawn — see `CODE_OWNED`.
     *
     * Retiring «دفاع نهایی» does not remove a category; it removes the
     * final-defence worksheet from every case that reaches that stage, and
     * nothing anywhere says so. Offering it again is always allowed: that is
     * the direction that restores the software's own assumptions.
     */
    if (retired && isRequiredValue(before.set, before.value)) return "refused" as const;
    if ((before.retiredAt !== null) === retired) return "unchanged" as const;

    const [updated] = await tx
      .update(lookups)
      .set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()` })
      .where(eq(lookups.id, id))
      .returning({ id: lookups.id });
    if (!updated) return "missing" as const;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "lookups.value.update",
      entityType: "lookup",
      entityId: `${before.set}:${before.value}`,
      changes: JSON.stringify({
        retired: { from: before.retiredAt !== null, to: retired },
      }),
    });

    return "changed" as const;
  });

  if (outcome === "missing") return { ok: false, message: "record.missing" };
  if (outcome === "refused") return { ok: false, message: "valueRequired" };
  if (outcome === "changed") revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}

/**
 * Moving an entry up or down the list somebody choosing from will read.
 *
 * A swap with the neighbour rather than a rewritten sequence: the order is what
 * an office arranged by hand, and renumbering the whole set on every nudge is
 * how positions drift apart from it.
 */
export async function moveLookupEntry(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("lookups.manage");

  const id = String(form.get("id") ?? "");
  const direction = String(form.get("direction") ?? "");
  if (id === "" || !isUuid(id) || (direction !== "up" && direction !== "down")) {
    return { ok: false, message: "saveFailed" };
  }

  const outcome = await withTenant(viewer.tenantId, async (tx) => {
    /* The set is not known until this row is read. Once known, serialise the
       ordering mutation and re-read under the lock so a concurrent add/move
       cannot make the neighbour calculation stale. */
    const [candidate] = await tx
      .select({ set: lookups.set })
      .from(lookups)
      .where(eq(lookups.id, id))
      .limit(1);
    if (!candidate) return "missing" as const;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${viewer.tenantId}:lookup:${candidate.set}`}, 0))`,
    );

    const [current] = await tx
      .select({ set: lookups.set, value: lookups.value, position: lookups.position })
      .from(lookups)
      .where(eq(lookups.id, id))
      .limit(1);
    if (!current) return "missing" as const;

    const [neighbour] = await tx
      .select({ id: lookups.id, value: lookups.value, position: lookups.position })
      .from(lookups)
      .where(
        and(
          eq(lookups.set, current.set),
          not(eq(lookups.id, id)),
          direction === "up"
            ? sql`${lookups.position} <= ${current.position}`
            : sql`${lookups.position} >= ${current.position}`,
        ),
      )
      .orderBy(
        direction === "up"
          ? sql`${lookups.position} desc, ${lookups.label} desc`
          : sql`${lookups.position} asc, ${lookups.label} asc`,
      )
      .limit(1);

    /* Already at the end. Nothing to swap with, and nothing to report — the
       button is disabled there, and this is the same answer for a request that
       arrived any other way. */
    if (!neighbour) return "unchanged" as const;

    /*
     * Two entries can share a position — the seed writes them all at 0 — so a
     * plain swap would be a no-op. Where they are equal, the mover takes a step
     * past the neighbour instead.
     */
    const nextPosition =
      neighbour.position === current.position
        ? direction === "up"
          ? current.position - 1
          : current.position + 1
        : neighbour.position;

    if (neighbour.position === current.position) {
      const [updated] = await tx
        .update(lookups)
        .set({ position: nextPosition, updatedAt: sql`now()` })
        .where(eq(lookups.id, id))
        .returning({ id: lookups.id });
      if (!updated) return "missing" as const;
    } else {
      const [updated] = await tx
        .update(lookups)
        .set({ position: nextPosition, updatedAt: sql`now()` })
        .where(eq(lookups.id, id))
        .returning({ id: lookups.id });
      if (!updated) return "missing" as const;
      await tx
        .update(lookups)
        .set({ position: current.position, updatedAt: sql`now()` })
        .where(eq(lookups.id, neighbour.id));
    }

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "lookups.value.update",
      entityType: "lookup",
      entityId: `${current.set}:${current.value}`,
      changes: JSON.stringify({
        position: { from: current.position, to: nextPosition },
      }),
    });
    if (neighbour.position !== current.position) {
      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "lookups.value.update",
        entityType: "lookup",
        entityId: `${current.set}:${neighbour.value}`,
        changes: JSON.stringify({
          position: { from: neighbour.position, to: current.position },
        }),
      });
    }
    return "changed" as const;
  });

  if (outcome === "missing") return { ok: false, message: "record.missing" };
  if (outcome === "changed") revalidatePath("/", "layout");
  return { ok: true };
}
