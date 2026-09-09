import { describe, expect, it } from "vitest";
import {
  canonicalAuthUsername,
  canonicalPlatformUsername,
  isPlatformAuthUsername,
  isValidLocalUsername,
  isValidTenantSlug,
  TENANT_SLUG_MAXIMUM_LENGTH,
  TENANT_SLUG_MINIMUM_LENGTH,
} from "./auth-username.ts";

describe("tenant-scoped sign-in identifiers", () => {
  it("uses one tenant slug contract at both provisioning boundaries", () => {
    expect(TENANT_SLUG_MINIMUM_LENGTH).toBe(2);
    expect(TENANT_SLUG_MAXIMUM_LENGTH).toBe(64);
    expect(isValidTenantSlug("ab")).toBe(true);
    expect(isValidTenantSlug("a-b")).toBe(true);
    expect(isValidTenantSlug("a".repeat(64))).toBe(true);
    expect(isValidTenantSlug("a")).toBe(false);
    expect(isValidTenantSlug("a".repeat(65))).toBe(false);
    expect(isValidTenantSlug("-ab")).toBe(false);
    expect(isValidTenantSlug("ab-")).toBe(false);
  });

  it("validates the local username before creating Better Auth's global key", () => {
    expect(isValidLocalUsername("admin_1")).toBe(true);
    expect(isValidLocalUsername("a b")).toBe(false);
    expect(() => canonicalAuthUsername("uni-a", "a b")).toThrow("invalid tenant-scoped username");
  });

  it("keeps identical local usernames distinct between universities", () => {
    expect(canonicalAuthUsername("uni-a", "admin")).not.toBe(
      canonicalAuthUsername("uni-b", "admin"),
    );
    expect(canonicalAuthUsername("uni-a", "ADMIN")).toBe(canonicalAuthUsername("uni-a", "admin"));
  });

  it("keeps platform operators outside every university namespace", () => {
    expect(canonicalPlatformUsername("Developer_1")).toBe("platform_developer_1");
    expect(isPlatformAuthUsername("platform_developer_1")).toBe(true);
    expect(() => canonicalPlatformUsername("a b")).toThrow("invalid platform username");
  });
});
