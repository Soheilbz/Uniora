import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { jobs } from "@/db/schema.ts";
import type { TenantTx } from "@/db/tenant.ts";
import { withTenant } from "@/db/tenant.ts";
import { recordJobEnqueued } from "@/lib/observability/metrics.ts";
import { stableJson } from "@/lib/stable-json.ts";

export interface TenantJobRequest {
  tenantId: string;
  requestedBy: string;
  kind: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  scheduledAt?: Date;
  maxAttempts?: number;
}

export async function enqueueTenantJob(
  input: TenantJobRequest,
): Promise<{ id: string; deduplicated: boolean }> {
  return withTenant(input.tenantId, (tx) => enqueueTenantJobInTx(tx, input));
}

/** Use this variant when the domain mutation and job request must commit together. */
export async function enqueueTenantJobInTx(
  tx: TenantTx,
  input: TenantJobRequest,
): Promise<{ id: string; deduplicated: boolean }> {
  const payload = stableJson(input.payload ?? {});
  const dedupeKey = input.dedupeKey ?? null;
  if (dedupeKey) {
    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.tenantId, input.tenantId),
          eq(jobs.kind, input.kind),
          eq(jobs.dedupeKey, dedupeKey),
          inArray(jobs.status, ["queued", "running", "retry"]),
        ),
      )
      .limit(1);
    if (existing) {
      recordJobEnqueued(input.kind, true);
      return { id: existing.id, deduplicated: true };
    }
  }
  const [created] = await tx
    .insert(jobs)
    .values({
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      kind: input.kind,
      executionClass: "tenant",
      payload,
      dedupeKey,
      scheduledAt: input.scheduledAt ?? new Date(),
      maxAttempts: Math.min(Math.max(input.maxAttempts ?? 5, 1), 20),
    })
    .returning({ id: jobs.id });
  if (!created) throw new Error("failed to enqueue tenant job");
  recordJobEnqueued(input.kind, false);
  return { id: created.id, deduplicated: false };
}

export function jobDedupeKey(kind: string, payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${kind}\0${stableJson(payload)}`)
    .digest("hex");
}
