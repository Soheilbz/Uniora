import { afterEach, describe, expect, it, vi } from "vitest";
import { S3CompatibleStorage } from "./s3-compatible.ts";

function storage() {
  return new S3CompatibleStorage({
    endpoint: "https://storage.internal.example",
    publicEndpoint: "https://storage.example",
    region: "eu-west-1",
    bucket: "univ-artifacts",
    accessKeyId: "test-access",
    secretAccessKey: "x".repeat(40),
    pathStyle: true,
    timeoutMs: 5_000,
    maxReadBytes: 1024 * 1024,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("S3-compatible object key safety", () => {
  it.each([
    "",
    ".",
    "..",
    "tenant/../secret",
    "tenant/./file",
    "tenant//file",
    "tenant/file\nname",
  ])("rejects unsafe key %j", async (key) => {
    await expect(storage().signedGetUrl(key)).rejects.toThrow(/key|segment/i);
  });

  it("preserves a tenant-scoped path in the signed URL", async () => {
    const signed = new URL(await storage().signedGetUrl("tenant-1/attachments/file.pdf", 300));
    expect(signed.pathname).toBe("/univ-artifacts/tenant-1/attachments/file.pdf");
    expect(signed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
  });
});

describe("S3-compatible transport safety", () => {
  it("fails closed when GET declares a body larger than the configured limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-length": String(2 * 1024 * 1024) },
          }),
      ),
    );
    await expect(storage().get("tenant-1/attachments/file.pdf")).rejects.toThrow(/read limit/i);
  });

  it("rejects an embedded CopyObject error even when the transport returned HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<Error><Code>InternalError</Code></Error>", { status: 200 })),
    );
    await expect(
      storage().copyIfMatch("tenant-1/source.pdf", "tenant-1/destination.pdf", "etag-1"),
    ).rejects.toThrow(/embedded error/i);
  });

  it("maps CopyObject precondition failures to a source-change error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 412 })),
    );
    await expect(
      storage().copyIfMatch("tenant-1/source.pdf", "tenant-1/destination.pdf", "etag-1"),
    ).rejects.toThrow(/source changed/i);
  });

  it("never follows redirects for signed storage operations", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await storage().put(
      "tenant-1/attachments/file.pdf",
      new Uint8Array([1, 2, 3]),
      "application/pdf",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
});
