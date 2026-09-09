import { and, desc, eq } from "drizzle-orm";
import { auditLog, user } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { parseAuditChanges } from "@/lib/audit/changes.ts";

/**
 * What was done to one record, and by whom.
 *
 * ── Why the record page reads the trail rather than keeping its own ─────────
 *
 * There is one log. The settings screen reads it across the whole institution
 * and a record page reads the slice belonging to one row, but they are the same
 * rows and they must describe an event the same way — a build where «ویرایش
 * مشخصات کاربر» on one screen is «update» on another has two histories and no
 * way to reconcile them.
 *
 * ── The most recent twenty ──────────────────────────────────────────────────
 *
 * A record's history is read to answer «who changed this, and when» about
 * something noticed today. Twenty covers that, and the whole trail — with its
 * filters, its paging and its own screen — is a click away for the rare case
 * that does not.
 */

export const RECENT_EVENTS = 20;

export interface RecordEvent {
  id: string;
  createdAt: Date;
  action: string;
  /** Null where the account has since been removed — the event still happened. */
  actorName: string | null;
  /** Field-level detail, where the write recorded any. */
  changes: { field: string; from: unknown; to: unknown }[];
}

export async function readRecordHistory(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<RecordEvent[]> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        actorName: user.name,
        changes: auditLog.changes,
      })
      .from(auditLog)
      /*
       * A left join, so an event whose actor has since been removed still
       * appears. The question this tab answers is «what happened to this
       * record», and an inner join would quietly drop exactly the events an
       * auditor is most likely to be looking for.
       */
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.createdAt))
      .limit(RECENT_EVENTS),
  );

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    action: row.action,
    actorName: row.actorName,
    changes: parseAuditChanges(row.changes),
  }));
}
