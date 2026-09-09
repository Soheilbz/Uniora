import { describe, expect, it } from "vitest";
import { isSignInCredentialAttempt, isSignInPath, signInIdentifier } from "./login-guard.ts";

describe("isSignInPath", () => {
  it("recognises valid sign-in endpoints", () => {
    expect(isSignInPath("/sign-in/username")).toBe(true);
    expect(isSignInPath("/sign-in/email")).toBe(true);
  });

  it("refuses arbitrary or unrecognized paths", () => {
    expect(isSignInPath("/sign-in")).toBe(false);
    expect(isSignInPath("/api/auth/sign-in")).toBe(false);
    expect(isSignInPath("/dashboard")).toBe(false);
  });
});

describe("signInIdentifier", () => {
  it("extracts and lowercases username from object body", () => {
    expect(signInIdentifier({ username: "  Admin.User  " })).toBe("admin.user");
  });

  it("extracts and lowercases email when username is absent", () => {
    expect(signInIdentifier({ email: "  User@Univ.EDU  " })).toBe("user@univ.edu");
  });

  it("returns null for non-object or empty payload", () => {
    expect(signInIdentifier(null)).toBeNull();
    expect(signInIdentifier(undefined)).toBeNull();
    expect(signInIdentifier("string-payload")).toBeNull();
    expect(signInIdentifier({})).toBeNull();
    expect(signInIdentifier({ username: "   " })).toBeNull();
    expect(signInIdentifier({ username: "x".repeat(129) })).toBeNull();
  });
});

describe("isSignInCredentialAttempt", () => {
  it("accepts a bounded credential submission", () => {
    expect(isSignInCredentialAttempt({ username: "admin", password: "a-password" })).toBe(true);
    expect(isSignInCredentialAttempt({ email: "user@univ.edu", password: "a-password" })).toBe(
      true,
    );
  });

  it("does not count malformed or oversized submissions", () => {
    expect(isSignInCredentialAttempt({ username: "admin" })).toBe(false);
    expect(isSignInCredentialAttempt({ username: "admin", password: "" })).toBe(false);
    expect(isSignInCredentialAttempt({ username: "admin", password: "x".repeat(129) })).toBe(false);
    expect(isSignInCredentialAttempt(null)).toBe(false);
  });
});
