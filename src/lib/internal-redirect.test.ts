import { describe, expect, it } from "vitest";
import { isSafeInternalPath, safeInternalRedirectPath } from "./internal-redirect.ts";

describe("safeInternalRedirectPath", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example",
    "/%2Fevil.example",
    "/safe\r\nLocation: https://evil.example",
    "/safe%0d%0aLocation:evil",
  ])("rejects ambiguous or external target %s", (value) => {
    expect(safeInternalRedirectPath(value)).toBe("/");
  });

  it("preserves a canonical internal path, query, and fragment", () => {
    expect(safeInternalRedirectPath("/settings?tab=security#keys")).toBe(
      "/settings?tab=security#keys",
    );
  });

  it("enforces a pathname boundary for the platform console", () => {
    expect(
      safeInternalRedirectPath("/platform/users?tab=active", {
        fallback: "/platform",
        pathnamePrefix: "/platform",
      }),
    ).toBe("/platform/users?tab=active");
    expect(
      safeInternalRedirectPath("/platform-evil", {
        fallback: "/platform",
        pathnamePrefix: "/platform",
      }),
    ).toBe("/platform");
  });

  it("supports boolean validation for stored record links", () => {
    expect(isSafeInternalPath("/students/123")).toBe(true);
    expect(isSafeInternalPath("/\\evil.example")).toBe(false);
  });
});
