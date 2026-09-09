/**
 * Pure policy for the privileged platform queue.
 *
 * Keeping retry/recovery decisions out of the process runner makes the most
 * dangerous edge cases independently testable: a committed operation must win
 * over an exhausted lease, an unavailable audit store must never destroy a
 * retryable secret, and only permanent/exhausted failures become terminal.
 */
export const PLATFORM_WORKER_MAX_ATTEMPTS = 3;

const SUCCESS_AUDIT_ACTION: Readonly<Record<string, string>> = {
  "tenant.create": "tenant.created",
  "tenant.suspend": "tenant.suspend",
  "tenant.resume": "tenant.resume",
  "tenant.archive": "tenant.archive",
  "tenant.failed.purge": "tenant.failed.purged",
  "tenant.owner.set": "tenant.owner.recovered",
  "tenant.user.create": "tenant.user.created",
  "tenant.user.password.reset": "tenant.user.password.reset",
  "tenant.rename": "tenant.renamed",
  "backup.create": "backup.created",
  "backup.verify": "backup.verified",
  "break-glass.start": "break-glass.started",
  "break-glass.end": "break-glass.ended",
  "platform.operation.retry": "platform.operation.retried",
  "platform.operation.cancel": "platform.operation.cancelled",
};

export type AuditReconciliation = "success" | "absent" | "unavailable";
export type StaleDisposition = "complete" | "retry" | "terminal" | "hold";
export type FailureDisposition = "retry" | "terminal";

export function platformSuccessAuditAction(kind: string): string | null {
  return SUCCESS_AUDIT_ACTION[kind] ?? null;
}

export function platformWorkerAttempt(payload: unknown): number {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const worker = (payload as Record<string, unknown>).__worker;
  if (worker === null || typeof worker !== "object" || Array.isArray(worker)) return 0;
  const parsed = Number((worker as Record<string, unknown>).attempt ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function staleDisposition(
  attempt: number,
  audit: AuditReconciliation,
  maxAttempts = PLATFORM_WORKER_MAX_ATTEMPTS,
): StaleDisposition {
  if (audit === "success") return "complete";
  if (audit === "unavailable") return "hold";
  return attempt >= maxAttempts ? "terminal" : "retry";
}

export function failureDisposition(
  attempt: number,
  permanent: boolean,
  maxAttempts = PLATFORM_WORKER_MAX_ATTEMPTS,
): FailureDisposition {
  return permanent || attempt >= maxAttempts ? "terminal" : "retry";
}
