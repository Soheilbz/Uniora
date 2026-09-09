"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { calendarEntries } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { foldDigits } from "@/lib/digits.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isValidIsoDate } from "@/lib/register/validation.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

/**
 * Writing the office's own calendar entries.
 *
 * The only writable layer on that screen — see `queries.ts` for why the other
 * three are projections of registers that own them.
 */

/**
 * A clock time, in either digit set.
 *
 * The office types «۱۰:۳۰» on a Persian keyboard and «10:30» on a Latin one,
 * and both are the same hour. Accepting only one would mean an operator whose
 * keyboard is set the other way cannot enter a time at all — so both are taken
 * and the digits folded to ASCII on the way in, which is what every other
 * numeric field in this application does.
 */
const CLOCK = /^[0-9۰-۹]{1,2}:[0-9۰-۹]{1,2}$/;

/** `9:5` and `۰۹:۰۵` are the same time; both are stored as `09:05`. */
function normaliseClock(value: string): string | null {
  const written = foldDigits(value.trim());
  if (written === "") return null;
  const [hour, minute] = written.split(":");
  const hours = Number(hour);
  const minutes = Number(minute);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export async function saveCalendarEntry(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("calendar.view", "calendar.manage");

  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "0");
  const title = String(form.get("title") ?? "").trim();
  const date = String(form.get("entryDate") ?? "").trim();
  const notes = String(form.get("notes") ?? "").trim();
  const startRaw = String(form.get("startTime") ?? "").trim();
  const endRaw = String(form.get("endTime") ?? "").trim();

  const submitted = { title, entryDate: date, notes, startTime: startRaw, endTime: endRaw };

  if (id && (!isUuid(id) || !isRecordVersion(version))) {
    return { ok: false, message: "saveFailed", values: submitted };
  }

  const errors: Record<string, string> = {};
  if (title === "") errors.title = "required";
  if (title.length > 200) errors.title = "tooLong";
  if (!isValidIsoDate(date)) errors.entryDate = date === "" ? "required" : "badDate";
  if (notes.length > 2000) errors.notes = "tooLong";

  const start = startRaw === "" ? null : CLOCK.test(startRaw) ? normaliseClock(startRaw) : null;
  const end = endRaw === "" ? null : CLOCK.test(endRaw) ? normaliseClock(endRaw) : null;
  if (startRaw !== "" && start === null) errors.startTime = "badTime";
  if (endRaw !== "" && end === null) errors.endTime = "badTime";
  /*
   * An end before its start is refused rather than silently swapped.
   *
   * Swapping would be helpful exactly once and wrong every other time: «۱۴:۰۰
   * تا ۱۰:۰۰» is far more often a typo in one of the two fields than an
   * inversion of both, and the operator is the one who knows which.
   */
  if (start !== null && end !== null && end < start) errors.endTime = "endBeforeStart";

  if (Object.keys(errors).length > 0) return { ok: false, errors, values: submitted };

  const outcome = await withTenant(viewer.tenantId, async (tx) => {
    if (id === "") {
      const [created] = await tx
        .insert(calendarEntries)
        .values({
          tenantId: viewer.tenantId,
          title,
          notes: notes === "" ? null : notes,
          entryDate: date,
          startTime: start,
          endTime: end,
          authorId: viewer.userId,
        })
        .returning({ id: calendarEntries.id });
      if (!created) return "conflict" as const;

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "create",
        entityType: "calendar_entry",
        entityId: created.id,
        changes: JSON.stringify({
          title: { from: null, to: title },
          entryDate: { from: null, to: date },
        }),
      });
      return "saved" as const;
    }

    const [before] = await tx
      .select()
      .from(calendarEntries)
      .where(
        and(
          eq(calendarEntries.id, id),
          eq(calendarEntries.version, version),
          isNull(calendarEntries.deletedAt),
        ),
      )
      .limit(1);
    if (!before) return "missing" as const;
    if (before.version !== version) return "conflict" as const;

    const next = {
      title,
      notes: notes === "" ? null : notes,
      entryDate: date,
      startTime: start,
      endTime: end,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      const from = before[key] ?? null;
      const to = next[key] ?? null;
      if (String(from ?? "") !== String(to ?? "")) changes[key] = { from, to };
    }
    if (Object.keys(changes).length === 0) return "unchanged" as const;

    const updated = await tx
      .update(calendarEntries)
      .set({ ...next, version: version + 1, updatedAt: sql`now()` })
      .where(
        and(
          eq(calendarEntries.id, id),
          eq(calendarEntries.version, version),
          isNull(calendarEntries.deletedAt),
        ),
      )
      .returning({ id: calendarEntries.id });

    /* The same optimistic guard every record here carries: two people editing
       one note is rare, and the second save silently winning is not something
       either of them would find out about. */
    if (updated.length === 0) return "conflict" as const;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "update",
      entityType: "calendar_entry",
      entityId: id,
      changes: JSON.stringify(changes),
    });

    return "saved" as const;
  });

  if (outcome === "missing") return { ok: false, message: "saveFailed", values: submitted };
  if (outcome === "conflict") return { ok: false, message: "conflict", values: submitted };

  if (outcome === "saved") revalidatePath("/calendar");
  return { ok: true, message: "saved" };
}

export async function deleteCalendarEntry(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("calendar.view", "calendar.manage");
  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version") ?? "");
  if (id === "" || !isUuid(id) || !isRecordVersion(version)) {
    return { ok: false, message: "saveFailed" };
  }

  const removed = await withTenant(viewer.tenantId, async (tx) => {
    const retired = await tx
      .update(calendarEntries)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(calendarEntries.id, id),
          eq(calendarEntries.version, version),
          isNull(calendarEntries.deletedAt),
        ),
      )
      .returning({ title: calendarEntries.title });

    if (retired.length === 0) return false;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "delete",
      entityType: "calendar_entry",
      entityId: id,
      changes: JSON.stringify({ title: { from: retired[0]?.title ?? null, to: null } }),
    });
    return true;
  });

  if (!removed) return { ok: false, message: "conflict" };
  revalidatePath("/calendar");
  return { ok: true, message: "saved" };
}
