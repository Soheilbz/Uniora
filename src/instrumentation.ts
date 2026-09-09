import { registerOTel } from "@vercel/otel";
import { assertRuntimeConfig } from "@/lib/runtime-config.ts";

/**
 * Opt-in OpenTelemetry bootstrap for the Next.js server runtime.
 *
 * Nothing leaves a developer or self-hosted installation unless an OTLP
 * endpoint is configured. When it is present, @vercel/otel wires request/fetch
 * tracing and honours the standard OTEL_* environment variables, so the
 * collector can be changed without a code or deployment rebuild.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  assertRuntimeConfig();
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "univ-web",
  });
}
