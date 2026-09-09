import { createHash } from "node:crypto";
import { jobs, outboxEvents } from "@/db/schema.ts";
import type { TenantTx } from "@/db/tenant.ts";

export interface DomainEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
  availableAt?: Date;
}

/**
 * Persists integration events and a durable dispatcher request in the caller's
 * domain transaction. This is a transactional outbox, not event sourcing: the
 * domain tables remain authoritative and the audit log remains the compliance
 * trail.
 *
 * Dispatcher jobs are system-owned (`requestedBy = null`). The minute-bucketed
 * dedupe key prevents a burst of mutations from creating one job per event while
 * still allowing a newly-earlier event to schedule an earlier dispatcher.
 */
export async function appendDomainEvent(
  tx: TenantTx,
  tenantId: string,
  event: DomainEvent | readonly DomainEvent[],
): Promise<void> {
  const events = Array.isArray(event) ? event : [event];
  if (!events.length) return;

  const now = new Date();
  const normalized = events.map((item) => ({
    tenantId,
    eventType: item.type,
    aggregateType: item.aggregateType,
    aggregateId: item.aggregateId,
    payload: JSON.stringify(item.payload ?? {}),
    correlationId: item.correlationId ?? null,
    causationId: item.causationId ?? null,
    availableAt: item.availableAt ?? now,
  }));
  await tx.insert(outboxEvents).values(normalized);

  const firstAvailableAt = new Date(
    Math.min(...normalized.map((item) => item.availableAt.getTime())),
  );
  const minuteBucket = Math.floor(firstAvailableAt.getTime() / 60_000);
  const dedupeKey = createHash("sha256")
    .update(`outbox.dispatch\0${tenantId}\0${minuteBucket}`)
    .digest("hex");

  await tx
    .insert(jobs)
    .values({
      tenantId,
      requestedBy: null,
      kind: "outbox.dispatch",
      executionClass: "tenant",
      payload: "{}",
      dedupeKey,
      scheduledAt: firstAvailableAt,
      maxAttempts: 8,
    })
    .onConflictDoNothing();
}
