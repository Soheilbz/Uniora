import { createHash, createHmac } from "node:crypto";
import type { ObjectStorage, StoredObjectHead } from "./storage-types.ts";

interface S3Config {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
  timeoutMs: number;
  maxReadBytes: number;
}

/** Minimal SigV4 client so S3/MinIO/Azure-S3-compatible storage adds no SDK to the Web bundle. */
export class S3CompatibleStorage implements ObjectStorage {
  private readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  static fromEnvironment(): S3CompatibleStorage {
    const endpoint = requiredHttpsOrLocalEndpoint("OBJECT_STORAGE_ENDPOINT").replace(/\/+$/, "");
    const publicEndpoint = requiredHttpsOrLocalEndpoint("OBJECT_STORAGE_PUBLIC_ENDPOINT").replace(
      /\/+$/,
      "",
    );
    return new S3CompatibleStorage({
      endpoint,
      publicEndpoint,
      region: process.env.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
      bucket: required("OBJECT_STORAGE_BUCKET"),
      accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: required("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
      pathStyle: requiredBoolean("OBJECT_STORAGE_PATH_STYLE", true),
      timeoutMs: boundedInt(process.env.OBJECT_STORAGE_TIMEOUT_MS, 15_000, 1_000, 120_000),
      maxReadBytes: boundedInt(
        process.env.OBJECT_STORAGE_MAX_READ_BYTES,
        110 * 1024 * 1024,
        1024 * 1024,
        512 * 1024 * 1024,
      ),
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const url = this.url(key);
    const payloadHash = sha256Hex(body);
    const headers = this.signedHeaders("PUT", url, payloadHash, { "content-type": contentType });
    const response = await this.fetch(url, { method: "PUT", headers, body: Buffer.from(body) });
    if (!response.ok) throw new Error(`Object storage PUT failed (${response.status})`);
  }

  async get(key: string): Promise<Uint8Array> {
    const url = this.url(key);
    const headers = this.signedHeaders("GET", url, EMPTY_SHA256, {});
    const response = await this.fetch(url, { method: "GET", headers });
    if (!response.ok) throw new Error(`Object storage GET failed (${response.status})`);
    const contentLength = response.headers.get("content-length");
    if (contentLength != null && Number(contentLength) > this.config.maxReadBytes) {
      throw new Error("Object storage GET exceeded the configured read limit");
    }
    return readBoundedBody(response, this.config.maxReadBytes);
  }

  async copyIfMatch(
    sourceKey: string,
    destinationKey: string,
    expectedEtag: string,
  ): Promise<void> {
    const normalizedEtag = expectedEtag.trim().replace(/^"|"$/g, "");
    if (!normalizedEtag || normalizedEtag.length > 200 || /[\r\n"]/u.test(normalizedEtag)) {
      throw new Error("Object storage copy requires a valid source ETag");
    }
    const url = this.url(destinationKey);
    const copySource = `/${encodeURIComponent(this.config.bucket)}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
    const extra = {
      "x-amz-copy-source": copySource,
      "x-amz-copy-source-if-match": `"${normalizedEtag}"`,
    };
    const headers = this.signedHeaders("PUT", url, EMPTY_SHA256, extra);
    const response = await this.fetch(url, { method: "PUT", headers });
    const body = await readBoundedBody(response, 512 * 1024);
    const text = new TextDecoder().decode(body);
    if (!response.ok) {
      if (response.status === 412)
        throw new Error("Object storage source changed before promotion");
      throw new Error(`Object storage COPY failed (${response.status})`);
    }
    // S3 CopyObject can report a mid-copy failure inside an HTTP 200 response.
    if (/<Error(?:\s|>)/i.test(text))
      throw new Error("Object storage COPY returned an embedded error");
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    const url = this.url(key);
    const headers = this.signedHeaders("HEAD", url, EMPTY_SHA256, {});
    const response = await this.fetch(url, { method: "HEAD", headers });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Object storage HEAD failed (${response.status})`);
    const length = response.headers.get("content-length");
    return {
      size: length == null ? null : Number(length),
      etag: response.headers.get("etag")?.replaceAll('"', "") ?? null,
      contentType: response.headers.get("content-type"),
    };
  }

  async delete(key: string): Promise<void> {
    const url = this.url(key);
    const headers = this.signedHeaders("DELETE", url, EMPTY_SHA256, {});
    const response = await this.fetch(url, { method: "DELETE", headers });
    if (!response.ok && response.status !== 404)
      throw new Error(`Object storage DELETE failed (${response.status})`);
  }

  async signedGetUrl(key: string, expiresSeconds = 300): Promise<string> {
    return this.presign("GET", key, expiresSeconds, {});
  }

  async signedPutUrl(key: string, contentType: string, expiresSeconds = 300): Promise<string> {
    if (!contentType.trim()) throw new Error("Content-Type is required for a signed upload");
    return this.presign("PUT", key, expiresSeconds, { "content-type": contentType.trim() });
  }

  private async fetch(url: URL, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
  }

  private url(key: string, publicUrl = false): URL {
    const segments = validatedObjectKeySegments(key);
    const cleanKey = segments.map(encodeURIComponent).join("/");
    const base = publicUrl ? this.config.publicEndpoint : this.config.endpoint;
    if (this.config.pathStyle)
      return new URL(`${base}/${encodeURIComponent(this.config.bucket)}/${cleanKey}`);
    const endpoint = new URL(base);
    endpoint.hostname = `${this.config.bucket}.${endpoint.hostname}`;
    endpoint.pathname = `/${cleanKey}`;
    return endpoint;
  }

  private signedHeaders(
    method: string,
    url: URL,
    payloadHash: string,
    extra: Record<string, string>,
  ): Headers {
    const now = new Date();
    const amzDate = amzTimestamp(now);
    const date = amzDate.slice(0, 8);
    const canonical = canonicalHeaders(url, {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extra,
    });
    const canonicalRequest = [
      method,
      canonicalUri(url),
      canonicalQuery(url),
      canonical.text,
      canonical.names,
      payloadHash,
    ].join("\n");
    const scope = `${date}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join(
      "\n",
    );
    const signature = hmacHex(
      signingKey(this.config.secretAccessKey, date, this.config.region),
      stringToSign,
    );
    const headers = new Headers(extra);
    headers.set("x-amz-date", amzDate);
    headers.set("x-amz-content-sha256", payloadHash);
    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${canonical.names}, Signature=${signature}`,
    );
    return headers;
  }

  private presign(
    method: string,
    key: string,
    expiresSeconds: number,
    signed: Record<string, string>,
  ): string {
    const expires = Math.min(Math.max(Math.trunc(expiresSeconds), 60), 3600);
    const url = this.url(key, true);
    const now = new Date();
    const amzDate = amzTimestamp(now);
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${this.config.region}/s3/aws4_request`;
    const canonical = canonicalHeaders(url, { host: url.host, ...signed });
    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", `${this.config.accessKeyId}/${scope}`);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(expires));
    url.searchParams.set("X-Amz-SignedHeaders", canonical.names);
    const canonicalRequest = [
      method,
      canonicalUri(url),
      canonicalQuery(url),
      canonical.text,
      canonical.names,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join(
      "\n",
    );
    url.searchParams.set(
      "X-Amz-Signature",
      hmacHex(signingKey(this.config.secretAccessKey, date, this.config.region), stringToSign),
    );
    return url.toString();
  }
}

const EMPTY_SHA256 = sha256Hex("");
function requiredBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

function validatedObjectKeySegments(key: string): string[] {
  if (!key || key.length > 2048 || key.includes("\0") || /[\r\n]/u.test(key)) {
    throw new Error("invalid object storage key");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("object storage key contains an unsafe path segment");
  }
  return segments;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function requiredHttpsOrLocalEndpoint(name: string): string {
  const value = required(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  const local =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:")
  ) {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error(
      `${name} must be an origin without credentials, path, query parameters, or fragments`,
    );
  return value;
}
function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw == null || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`numeric storage setting must be between ${min} and ${max}`);
  return value;
}
function amzTimestamp(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}
function hmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
function signingKey(secret: string, date: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
}
function canonicalUri(url: URL): string {
  return url.pathname
    .split("/")
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join("/")
    .replace(/%2F/gi, "/");
}
function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)))
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k).replace(/%7E/g, "~")}=${encodeURIComponent(v).replace(/%7E/g, "~")}`,
    )
    .join("&");
}
function canonicalHeaders(_url: URL, input: Record<string, string>) {
  const rows = Object.entries(input)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    text: rows.map(([k, v]) => `${k}:${v}\n`).join(""),
    names: rows.map(([k]) => k).join(";"),
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes)
        throw new Error("Object storage GET exceeded the configured read limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
