import { type Attributes, metrics, SpanStatusCode, trace } from "@opentelemetry/api";

const meter = metrics.getMeter("univ-web");
const tracer = trace.getTracer("univ-web");

const jobsEnqueued = meter.createCounter("univ.jobs.enqueued", {
  description: "Durable tenant jobs enqueued by kind and dedupe outcome.",
});
const apiRequests = meter.createCounter("univ.api.requests", {
  description: "External API authentication/request outcomes without tenant identifiers.",
});
const authAttempts = meter.createCounter("univ.auth.attempts", {
  description: "Interactive authentication outcomes without usernames or tenant identifiers.",
});
const operationDuration = meter.createHistogram("univ.operation.duration", {
  description: "Application operation duration in milliseconds.",
  unit: "ms",
});

function safeKind(value: string): string {
  return /^[a-z0-9._-]{1,80}$/i.test(value) ? value : "other";
}

export function recordJobEnqueued(kind: string, deduplicated: boolean): void {
  jobsEnqueued.add(1, { kind: safeKind(kind), deduplicated });
}

export function recordApiOutcome(
  outcome: "accepted" | "invalid_token" | "insufficient_scope" | "rate_limited",
): void {
  apiRequests.add(1, { outcome });
}

export function recordAuthOutcome(outcome: "succeeded" | "rejected" | "refused"): void {
  authAttempts.add(1, { outcome });
}

export async function observeOperation<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const value = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return value;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      operationDuration.record(Math.max(0, performance.now() - started), {
        operation: safeKind(name),
      });
      span.end();
    }
  });
}
