import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

const DEFAULT_ALLOWED_PORTS = new Set(["", "443"]);

export interface PinnedHttpsResponse {
  ok: boolean;
  status: number;
  body: Uint8Array;
}

/** Rejects non-routable, private, documentation, benchmark and transition ranges. */
export function isPrivateOrSpecialIp(address: string): boolean {
  const normalizedAddress = address.trim().replace(/^\[|\]$/g, "");
  const version = isIP(normalizedAddress);
  if (version === 4) {
    const parts = normalizedAddress.split(".").map(Number);
    const [a = -1, b = -1, c = -1] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = normalizedAddress.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      return isIP(mapped) === 4 ? isPrivateOrSpecialIp(mapped) : true;
    }
    const [firstRaw = "0", secondRaw = "0"] = normalized.split(":");
    const first = Number.parseInt(firstRaw || "0", 16);
    const second = Number.parseInt(secondRaw || "0", 16);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return true;

    // Be deliberately conservative for server-side outbound traffic: accept
    // only the IPv6 global-unicast block (2000::/3), then subtract IANA/RFC
    // special-use subranges that are unsuitable as integration targets.
    if ((first & 0xe000) !== 0x2000) return true;
    return (
      (first === 0x2001 && second <= 0x01ff) || // IETF protocol assignments (2001::/23)
      (first === 0x2001 && second === 0x0db8) || // documentation (2001:db8::/32)
      first === 0x2002 || // 6to4; embedded IPv4 can bypass policy
      (first === 0x3fff && second < 0x1000) // documentation (3fff::/20)
    );
  }
  return true;
}

export function validateWebhookEndpointSyntax(
  value: string,
  allowedPrivateHosts: ReadonlySet<string> = new Set(),
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("outbound endpoint must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:") throw new Error("outbound endpoint must use HTTPS");
  if (url.username || url.password)
    throw new Error("outbound endpoint must not contain credentials");
  if (!DEFAULT_ALLOWED_PORTS.has(url.port))
    throw new Error("outbound endpoint must use the standard HTTPS port");
  const hostname = normalizeHostname(url.hostname);
  const explicitlyAllowed = allowedPrivateHosts.has(hostname);
  if (
    !hostname ||
    (!explicitlyAllowed &&
      (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")))
  ) {
    throw new Error("outbound endpoint host is not allowed");
  }
  if (!explicitlyAllowed && isIP(hostname) && isPrivateOrSpecialIp(hostname)) {
    throw new Error("outbound endpoint must not target a private or special-use address");
  }
  url.hash = "";
  return url;
}

export async function validatePublicHttpsEndpoint(value: string): Promise<URL> {
  return (await resolvePublicHttpsEndpoint(value)).url;
}

/**
 * Performs HTTPS with DNS resolution pinned to the address that passed the SSRF
 * check. This removes the validation-to-connect DNS-rebinding/TOCTOU window.
 * Redirects are intentionally not followed; callers must validate each target.
 */
export interface PinnedHttpsRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export async function pinnedPublicHttpsRequest(
  value: string,
  input: PinnedHttpsRequestOptions = {},
): Promise<PinnedHttpsResponse> {
  return performPinnedHttpsRequest(await resolvePublicHttpsEndpoint(value), input);
}

/**
 * Same pinned transport as public integrations, with one deliberate escape
 * hatch for operator-controlled infrastructure such as an internal KMS. A
 * private/special address is accepted only when the URL hostname itself is on
 * the explicit allowlist; the resolved address is still pinned to the socket.
 */
export async function pinnedAllowlistedHttpsRequest(
  value: string,
  input: PinnedHttpsRequestOptions,
  allowedPrivateHosts: ReadonlySet<string>,
): Promise<PinnedHttpsResponse> {
  const parsed = validateWebhookEndpointSyntax(value, allowedPrivateHosts);
  const hostname = normalizeHostname(parsed.hostname);
  if (!allowedPrivateHosts.has(hostname)) {
    return performPinnedHttpsRequest(await resolvePublicHttpsEndpoint(value), input);
  }
  const literal = isIP(hostname);
  if (literal === 4 || literal === 6) {
    return performPinnedHttpsRequest(
      { url: parsed, hostname, address: hostname, family: literal },
      input,
    );
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("allowlisted outbound endpoint did not resolve");
  const selected = records[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new Error("allowlisted outbound endpoint resolved to an unsupported address");
  }
  return performPinnedHttpsRequest(
    { url: parsed, hostname, address: selected.address, family: selected.family },
    input,
  );
}

async function performPinnedHttpsRequest(
  target: { url: URL; hostname: string; address: string; family: 4 | 6 },
  input: PinnedHttpsRequestOptions,
): Promise<PinnedHttpsResponse> {
  const timeoutMs = boundedInt(input.timeoutMs ?? 15_000, 1_000, 120_000, "outbound timeout");
  const maxResponseBytes = boundedInt(
    input.maxResponseBytes ?? 1024 * 1024,
    1,
    100 * 1024 * 1024,
    "outbound response limit",
  );
  const body =
    typeof input.body === "string"
      ? Buffer.from(input.body, "utf8")
      : input.body
        ? Buffer.from(input.body)
        : undefined;

  return new Promise<PinnedHttpsResponse>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: target.hostname,
        port: "443",
        path: `${target.url.pathname}${target.url.search}`,
        method: input.method ?? "GET",
        headers: input.headers,
        servername: target.hostname,
        family: target.family,
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      } as RequestOptions,
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.byteLength;
          if (total > maxResponseBytes) {
            request.destroy(new Error("outbound response exceeds the safety limit"));
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: new Uint8Array(Buffer.concat(chunks)),
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error("outbound HTTPS request timed out")),
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function resolvePublicHttpsEndpoint(
  value: string,
): Promise<{ url: URL; hostname: string; address: string; family: 4 | 6 }> {
  const url = validateWebhookEndpointSyntax(value);
  const hostname = normalizeHostname(url.hostname);
  const literal = isIP(hostname);
  if (literal === 4 || literal === 6) return { url, hostname, address: hostname, family: literal };

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("outbound endpoint did not resolve");
  if (records.some((record) => isPrivateOrSpecialIp(record.address))) {
    throw new Error("outbound endpoint resolves to a private or special-use address");
  }
  const selected = records[0];
  if (!selected || (selected.family !== 4 && selected.family !== 6))
    throw new Error("outbound endpoint resolved to an unsupported address");
  return { url, hostname, address: selected.address, family: selected.family };
}

function normalizeHostname(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
}

function boundedInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} is invalid`);
  return value;
}
