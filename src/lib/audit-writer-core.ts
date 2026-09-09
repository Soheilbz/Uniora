import { auditLog } from "@/db/schema.ts";
import type { TenantTx } from "@/db/tenant.ts";
import { currentRequestMetadata, type RequestMetadata } from "@/lib/request-context.ts";

export type AuditEvent = typeof auditLog.$inferInsert;

export interface AuditEnvelope {
  sessionId?: string | null;
  request?: RequestMetadata;
}

/**
 * The only low-level Web-process writer for the tenant audit trail.
 *
 * Keeping metadata enrichment here prevents dozens of Server Actions from
 * slowly drifting apart. The writer is intentionally independent from the
 * auth/session module so authentication hooks can use it without creating an
 * auth -> audit -> session -> auth dependency cycle.
 */
export async function writeAuditEventCore(
  tx: TenantTx,
  event: AuditEvent | readonly AuditEvent[],
  envelope: AuditEnvelope = {},
): Promise<void> {
  const request = envelope.request ?? (await currentRequestMetadata());
  const events = Array.isArray(event) ? event : [event];
  if (events.length === 0) return;

  await tx.insert(auditLog).values(
    events.map((value) => ({
      ...value,
      requestId: value.requestId ?? request.requestId,
      sessionId: value.sessionId ?? envelope.sessionId ?? null,
      ipAddress: value.ipAddress ?? request.ipAddress,
      userAgent: value.userAgent ?? request.userAgent,
      outcome: value.outcome ?? "success",
      source: value.source ?? "web",
    })),
  );
}
