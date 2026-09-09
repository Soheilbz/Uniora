import { describe, expect, it } from "vitest";
import { verifyTotp } from "./mfa.ts";

/* RFC 6238 SHA-1 test secret, encoded as the authenticator apps expect it. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("MFA TOTP verification", () => {
  it("accepts the RFC 6238 six-digit SHA-1 vector", () => {
    expect(verifyTotp(RFC_SECRET, "287082", 59_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "081804", 1_111_111_109_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "005924", 1_234_567_890_000)).toBe(true);
  });

  it("folds Persian and Arabic-Indic digits before validation", () => {
    expect(verifyTotp(RFC_SECRET, "۲۸۷۰۸۲", 59_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, "٠٨١٨٠٤", 1_111_111_109_000)).toBe(true);
  });

  it("rejects malformed or incorrect codes", () => {
    expect(verifyTotp(RFC_SECRET, "287083", 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "28708", 59_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "2870827", 59_000)).toBe(false);
  });
});
