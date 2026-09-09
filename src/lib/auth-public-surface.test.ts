import { describe, expect, it } from "vitest";
import { isPublicAuthRequest } from "./auth-public-surface.ts";

describe("browser-facing authentication surface", () => {
  it("exposes only tenant-scoped username sign-in", () => {
    expect(isPublicAuthRequest("POST", "/api/auth/sign-in/username")).toBe(true);
  });

  it("exposes the public passkey authentication ceremony", () => {
    expect(isPublicAuthRequest("GET", "/api/auth/passkey/generate-authenticate-options")).toBe(
      true,
    );
    expect(isPublicAuthRequest("POST", "/api/auth/sign-in/passkey")).toBe(true);
  });

  it.each([
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/sign-up/email"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/revoke-session"],
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/auth/list-sessions"],
    ["GET", "/api/auth/sign-in/username"],
    ["GET", "/api/auth/scim/v2evil"],
  ])("rejects %s %s", (method, path) => {
    expect(isPublicAuthRequest(method, path)).toBe(false);
  });
  it.each([
    ["GET", "/api/auth/scim/v2/Users"],
    ["POST", "/api/auth/scim/v2/Users"],
    ["PATCH", "/api/auth/scim/v2/Groups/123"],
  ])("allows SCIM only below the exact v2 route boundary: %s %s", (method, path) => {
    expect(isPublicAuthRequest(method, path)).toBe(true);
  });
});
