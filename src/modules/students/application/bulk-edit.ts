import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { students } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { formOptions, lookupTable } from "@/lib/lookups.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { MAX_BULK_EDIT_RECORDS } from "@/lib/register/bulk-edit.ts";
import { same } from "@/lib/register/changes.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { uuidList } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { STUDENT_FIELDS } from "../fields.ts";
import { BULK_EDITABLE } from "../model.ts";

const BASE = "/students";

/**
 * Sets one vocabulary field across a selection of students.
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
/**
 * The columns a bulk edit may write, by field key.
 *
 * A closed map rather than indexing the table object with the posted string:
 * the allow-list above says *which* fields may be set, and this says which
 * column each one is. A key that passes the first check always finds its
 * column here.
 */
const BULK_COLUMN = {
  status: students.status,
  degree: students.degree,
} as const;

export async function bulkEditStudents(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("students.manage");

  const key = String(form.get("field") ?? "");
  const value = String(form.get("value") ?? "");
  const ids = uuidList(form.getAll("id"), MAX_BULK_EDIT_RECORDS);

  if (ids === null) return { ok: false, message: "errors.bulk.selection" };
  if (ids.length === 0) return { ok: true };
  if (!BULK_EDITABLE.includes(key)) return { ok: false, message: "errors.bulk.field" };
  if (key === "degree" && !viewer.capabilities.includes("students.degree")) {
    return { ok: false, message: "errors.permission" };
  }

  const field = STUDENT_FIELDS.find((candidate) => candidate.key === key);
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

  /* The version each ticked row carried when it was rendered, posted beside
     its id — `version.<id>` per row, so one missing version cannot shift the
     rest onto the wrong records. */
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
      .select({ id: students.id, version: students.version, from: column })
      .from(students)
      .where(and(inArray(students.id, ids), isNull(students.deletedAt)));

    /*
     * ── Every row keeps its own version guard ────────────────────────────────
     *
     * The write matches on the version each row was read at, so a record
     * somebody else edited between the selection and the apply is skipped
     * rather than silently overwritten — the same guard a single-record save
     * uses, applied across the whole selection. Rows are grouped by expected
     * version so the selection costs a handful of guarded statements instead
     * of one per row; within a group, any id whose version moved on before
     * this statement ran simply does not come back from `.returning`, and is
     * left out of the count.
     */
    const groups = new Map<number, string[]>();
    const fromById = new Map<string, unknown>();
    for (const row of current) {
      fromById.set(row.id, row.from);
      const expected = expectedById.get(row.id);
      /* Never rendered with a version, or edited since → skipped. */
      if (expected === undefined || row.version !== expected) continue;
      /* Already holding the value → nothing to write, nothing to audit. */
      if (same("text", row.from, value)) continue;
      const bucket = groups.get(expected);
      if (bucket) bucket.push(row.id);
      else groups.set(expected, [row.id]);
    }

    let changedCount = 0;
    for (const [expected, groupIds] of groups) {
      const updated = await tx
        .update(students)
        .set({ [key]: value, updatedAt: new Date(), version: sql`version + 1` })
        .where(
          and(
            inArray(students.id, groupIds),
            eq(students.version, expected),
            isNull(students.deletedAt),
          ),
        )
        .returning({ id: students.id });

      changedCount += updated.length;

      /* One entry per record — the trail is asked «who changed this student»,
         one person at a time, and a row saying «40 records» cannot answer it.
         Each names what the field was as well as what it became, like every
         other write in the system. */
      if (updated.length > 0) {
        await writeAuditEvent(
          tx,
          updated.map((row) => ({
            tenantId: viewer.tenantId,
            actorId: viewer.userId,
            action: "update",
            entityType: "student",
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
