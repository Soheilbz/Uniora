import { describe, expect, it } from "vitest";
import {
  failureDisposition,
  PLATFORM_WORKER_MAX_ATTEMPTS,
  platformSuccessAuditAction,
  platformWorkerAttempt,
  staleDisposition,
} from "./worker-policy";

describe("platform worker recovery policy", () => {
  it("maps every queued privileged operation to its durable success audit", () => {
    expect(platformSuccessAuditAction("tenant.create")).toBe("tenant.created");
    expect(platformSuccessAuditAction("tenant.suspend")).toBe("tenant.suspend");
    expect(platformSuccessAuditAction("tenant.resume")).toBe("tenant.resume");
    expect(platformSuccessAuditAction("tenant.archive")).toBe("tenant.archive");
    expect(platformSuccessAuditAction("tenant.owner.set")).toBe("tenant.owner.recovered");
    expect(platformSuccessAuditAction("tenant.user.create")).toBe("tenant.user.created");
    expect(platformSuccessAuditAction("tenant.user.password.reset")).toBe(
      "tenant.user.password.reset",
    );
    expect(platformSuccessAuditAction("tenant.rename")).toBe("tenant.renamed");
    expect(platformSuccessAuditAction("unknown")).toBeNull();
  });

  it("reads only a non-negative integer attempt counter", () => {
    expect(platformWorkerAttempt({ __worker: { attempt: 2 } })).toBe(2);
    expect(platformWorkerAttempt({ __worker: { attempt: -1 } })).toBe(0);
    expect(platformWorkerAttempt({ __worker: { attempt: 1.5 } })).toBe(0);
    expect(platformWorkerAttempt({ __worker: { attempt: "2" } })).toBe(2);
    expect(platformWorkerAttempt({})).toBe(0);
    expect(platformWorkerAttempt(null)).toBe(0);
  });

  it("never reports a stale job failed when its success audit already exists", () => {
    expect(staleDisposition(PLATFORM_WORKER_MAX_ATTEMPTS, "success")).toBe("complete");
  });

  it("holds a stale lease when reconciliation itself is unavailable", () => {
    expect(staleDisposition(1, "unavailable")).toBe("hold");
    expect(staleDisposition(PLATFORM_WORKER_MAX_ATTEMPTS, "unavailable")).toBe("hold");
  });

  it("retries stale work below the limit and terminates only when exhausted", () => {
    expect(staleDisposition(1, "absent")).toBe("retry");
    expect(staleDisposition(PLATFORM_WORKER_MAX_ATTEMPTS, "absent")).toBe("terminal");
  });

  it("distinguishes retryable execution errors from permanent/exhausted ones", () => {
    expect(failureDisposition(1, false)).toBe("retry");
    expect(failureDisposition(1, true)).toBe("terminal");
    expect(failureDisposition(PLATFORM_WORKER_MAX_ATTEMPTS, false)).toBe("terminal");
  });
});
