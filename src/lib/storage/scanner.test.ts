import { afterEach, describe, expect, it, vi } from "vitest";
import { malwareScanner } from "./scanner.ts";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("HTTP malware scanner", () => {
  it("fails closed on insecure production endpoints", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ANTIVIRUS_HTTP_ENDPOINT = "http://scanner.example/scan";
    expect(() => malwareScanner()).toThrow(/HTTPS/i);
  });

  it("accepts a bounded clean verdict and sends no redirect-following request", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.ANTIVIRUS_HTTP_ENDPOINT = "http://127.0.0.1:9999/scan";
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ clean: true, detail: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await malwareScanner().scan({
      filename: "sample.csv",
      mimeType: "text/csv",
      bytes: new TextEncoder().encode("a,b"),
    });
    expect(result).toEqual({ verdict: "clean", provider: "http", detail: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("turns malformed scanner JSON into an error verdict", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.ANTIVIRUS_HTTP_ENDPOINT = "http://localhost:9999/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    const result = await malwareScanner().scan({
      filename: "sample.csv",
      mimeType: "text/csv",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.verdict).toBe("error");
  });

  it("turns non-success scanner responses into an error verdict", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.ANTIVIRUS_HTTP_ENDPOINT = "http://localhost:9999/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const result = await malwareScanner().scan({
      filename: "sample.csv",
      mimeType: "text/csv",
      bytes: new Uint8Array([1]),
    });
    expect(result).toEqual({ verdict: "error", provider: "http", detail: "HTTP 503" });
  });

  it("fails closed on an oversized scanner response", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.ANTIVIRUS_HTTP_ENDPOINT = "http://localhost:9999/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-length": String(128 * 1024) },
          }),
      ),
    );
    const result = await malwareScanner().scan({
      filename: "sample.csv",
      mimeType: "text/csv",
      bytes: new Uint8Array([1]),
    });
    expect(result).toEqual({
      verdict: "error",
      provider: "http",
      detail: "scanner returned invalid or oversized JSON",
    });
  });

  it("bounds provider detail before it reaches durable logs or UI", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.ANTIVIRUS_HTTP_ENDPOINT = "http://localhost:9999/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ clean: false, detail: "x".repeat(5000) }), { status: 200 }),
      ),
    );
    const result = await malwareScanner().scan({
      filename: "sample.csv",
      mimeType: "text/csv",
      bytes: new Uint8Array([1]),
    });
    expect(result.verdict).toBe("infected");
    expect(result.detail).toHaveLength(1000);
  });
});
