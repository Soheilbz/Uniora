import type { TenantTx } from "@/db/tenant.ts";
import { enqueueTenantJobInTx, jobDedupeKey } from "@/lib/jobs/enqueue.ts";

export type StorageReconcileResource = "attachment" | "import-batch";
export type StorageReconcilePolicy = "orphan-only" | "cleanup-candidates" | "expiry";

export interface StorageReconcileRequest {
  tenantId: string;
  requestedBy: string;
  resourceType: StorageReconcileResource;
  resourceId: string;
  policy: StorageReconcilePolicy;
  candidateKeys: string[];
  entityType?: string;
  entityId?: string;
  scheduledAt?: Date;
  maxAttempts?: number;
}

export function validatedStorageReconcileCandidateKeys(input: readonly string[]): string[] {
  const candidateKeys = [...new Set(input.map((key) => key.trim()).filter(Boolean))];
  if (candidateKeys.length < 1 || candidateKeys.length > 8) {
    throw new Error("storage reconciliation requires between 1 and 8 candidate object keys");
  }
  if (candidateKeys.some((key) => key.length > 2048 || /[\0\r\n]/.test(key))) {
    throw new Error("storage reconciliation contains an invalid object key");
  }
  return candidateKeys;
}

/**
 * Durable object-store reconciliation. Candidate keys are treated as untrusted
 * again by the worker; this helper only bounds payload size and creates a stable
 * dedupe key. The worker validates every key against tenant + resource identity
 * before a delete is attempted.
 */
export async function enqueueStorageReconcileInTx(tx: TenantTx, input: StorageReconcileRequest) {
  const candidateKeys = validatedStorageReconcileCandidateKeys(input.candidateKeys);
  const payload = {
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    policy: input.policy,
    candidateKeys,
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
  };
  return enqueueTenantJobInTx(tx, {
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
    kind: "storage.reconcile",
    payload,
    dedupeKey: jobDedupeKey("storage.reconcile", payload),
    ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    maxAttempts: input.maxAttempts ?? 12,
  });
}
