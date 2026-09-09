import { isIP } from "node:net";
import { trace } from "@opentelemetry/api";
import { headers } from "next/headers";

export interface RequestMetadata {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Metadata stamped by the server proxy for one HTTP request.
 *
 * x-forwarded-for is accepted only when a concrete trusted-proxy hop count is
 * configured. Production deployments must make the Web process unreachable
 * from untrusted networks and have the edge proxy append/replace forwarding
 * headers; otherwise client-controlled forwarding headers are not authoritative.
 */
export async function currentRequestMetadata(): Promise<RequestMetadata> {
  try {
    const requestHeaders = await headers();
    const requestId = requestHeaders.get("x-request-id");
    const ipAddress = trustedForwardedClientIp(requestHeaders.get("x-forwarded-for"));
    const userAgent = requestHeaders.get("user-agent");
    if (requestId) trace.getActiveSpan()?.setAttribute("app.request_id", requestId);
    return { requestId, ipAddress, userAgent };
  } catch {
    return { requestId: null, ipAddress: null, userAgent: null };
  }
}

function trustedForwardedClientIp(raw: string | null): string | null {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "0");
  if (!Number.isInteger(hops) || hops < 1 || hops > 5 || !raw) return null;
  const chain = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const index = chain.length - hops;
  if (index < 0) return null;
  const candidate = chain[index] ?? "";
  return isIP(candidate) ? candidate : null;
}
