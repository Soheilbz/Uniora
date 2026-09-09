const MIN_STALE_RECOVERY_MS = 10_000;
const MAX_STALE_RECOVERY_MS = 60_000;
const ARTIFACT_EXPIRY_MS = 60_000;

export function workerMaintenanceIntervals(leaseSeconds) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new TypeError("leaseSeconds must be a positive integer");
  }
  const staleRecoveryMs = Math.min(
    MAX_STALE_RECOVERY_MS,
    Math.max(MIN_STALE_RECOVERY_MS, Math.floor((leaseSeconds * 1000) / 3)),
  );
  return Object.freeze({
    staleRecoveryMs,
    artifactExpiryMs: ARTIFACT_EXPIRY_MS,
  });
}

export function createMaintenanceClock(nowMs = Date.now()) {
  return {
    recoverStaleJobsAt: nowMs,
    expireArtifactsAt: nowMs,
  };
}

export function maintenanceDue(clock, nowMs = Date.now()) {
  return Object.freeze({
    recoverStaleJobs: nowMs >= clock.recoverStaleJobsAt,
    expireArtifacts: nowMs >= clock.expireArtifactsAt,
  });
}

export function markMaintenanceRun(clock, task, intervalMs, nowMs = Date.now()) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new TypeError("maintenance interval must be positive");
  }
  const key =
    task === "recoverStaleJobs"
      ? "recoverStaleJobsAt"
      : task === "expireArtifacts"
        ? "expireArtifactsAt"
        : null;
  if (!key) throw new TypeError(`unknown maintenance task ${task}`);
  clock[key] = nowMs + intervalMs;
}
