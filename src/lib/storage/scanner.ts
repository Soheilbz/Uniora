export type ScanVerdict = "clean" | "infected" | "error";
export interface ScanResult {
  verdict: ScanVerdict;
  provider: string;
  detail?: string;
}
export interface MalwareScanner {
  scan(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ScanResult>;
}

class HttpMalwareScanner implements MalwareScanner {
  private readonly endpoint: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;

  constructor(endpoint: string, token: string | undefined, timeoutMs: number) {
    this.endpoint = endpoint;
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async scan(input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<ScanResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "content-type": input.mimeType || "application/octet-stream",
        "content-length": String(input.bytes.byteLength),
        "x-filename": encodeURIComponent(input.filename),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: Buffer.from(input.bytes),
    });
    if (!response.ok)
      return { verdict: "error", provider: "http", detail: `HTTP ${response.status}` };

    let body: { clean?: boolean; verdict?: string; detail?: string };
    try {
      body = JSON.parse(await readBoundedText(response, 64 * 1024)) as typeof body;
    } catch {
      return {
        verdict: "error",
        provider: "http",
        detail: "scanner returned invalid or oversized JSON",
      };
    }
    const detail = boundedDetail(body.detail);
    if (body.clean === true || body.verdict === "clean")
      return { verdict: "clean", provider: "http", ...(detail ? { detail } : {}) };
    if (body.clean === false || body.verdict === "infected")
      return { verdict: "infected", provider: "http", ...(detail ? { detail } : {}) };
    return {
      verdict: "error",
      provider: "http",
      detail: boundedDetail(body.detail) ?? "scanner returned no verdict",
    };
  }
}

export function malwareScanner(): MalwareScanner {
  const endpoint = validatedScannerEndpoint(process.env.ANTIVIRUS_HTTP_ENDPOINT?.trim());
  const timeoutMs = boundedInt(process.env.ANTIVIRUS_HTTP_TIMEOUT_MS, 20_000, 1_000, 120_000);
  return new HttpMalwareScanner(endpoint, process.env.ANTIVIRUS_HTTP_TOKEN?.trim(), timeoutMs);
}

function validatedScannerEndpoint(raw: string | undefined): string {
  if (!raw) throw new Error("ANTIVIRUS_HTTP_ENDPOINT is not configured");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ANTIVIRUS_HTTP_ENDPOINT must be an absolute URL");
  }
  if (url.username || url.password || url.hash)
    throw new Error("ANTIVIRUS_HTTP_ENDPOINT must not contain credentials or fragments");
  const local =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:")
  ) {
    throw new Error("ANTIVIRUS_HTTP_ENDPOINT must use HTTPS outside local development");
  }
  return url.toString();
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("response exceeds safety limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("response exceeds safety limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function boundedDetail(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, 1000) : undefined;
}
function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw == null || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`ANTIVIRUS_HTTP_TIMEOUT_MS must be between ${min} and ${max}`);
  return value;
}
