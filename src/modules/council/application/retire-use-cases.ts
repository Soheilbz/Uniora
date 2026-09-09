import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { councilDecisions, councilMeetings, type councilRulings } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { uuidList } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

const MEETINGS = "/council-meetings";
const DECISIONS = "/council-decisions";

async function retire(
  table: typeof councilMeetings | typeof councilDecisions | typeof councilRulings,
  entityType: string,
  basePath: string,
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
  revalidatePath(basePath);
  return { ok: true };
}

export async function deleteMeetings(_previous: ActionResult | null, form: FormData) {
  return retire(councilMeetings, "council_meeting", MEETINGS, form);
}

export async function deleteDecisions(_previous: ActionResult | null, form: FormData) {
  return retire(councilDecisions, "council_decision", DECISIONS, form);
}
