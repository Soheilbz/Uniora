import type { TenantTx } from "@/db/tenant.ts";
import { type AuditEvent, writeAuditEventCore } from "@/lib/audit-writer-core.ts";
import { currentSession } from "@/lib/session.ts";

/** Audit writer for authenticated Web mutations. */
export async function writeAuditEvent(
  tx: TenantTx,
  event: AuditEvent | readonly AuditEvent[],
): Promise<void> {
  let sessionId: string | null = null;
  try {
    sessionId = (await currentSession())?.session?.id ?? null;
  } catch {
    // Auth hooks and non-request tests may not have a session context.
  }
  await writeAuditEventCore(tx, event, { sessionId });
}
