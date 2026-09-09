import { describe, expect, it } from "vitest";
import { isAuthId } from "./auth-id.ts";

describe("isAuthId", () => {
  it("accepts Better Auth default base62 identifiers", () => {
    expect(isAuthId("Ab9Zx7Yw6Vu5Ts4Rq3Po2Nm1Lk0Ji8Hg")).toBe(true);
  });

  it("accepts UUID-shaped identifiers from older installations", () => {
    expect(isAuthId("0195f4d7-5e7b-7a8c-9d0e-112233445566")).toBe(true);
  });

  it("rejects empty, control-bearing and unbounded identifiers", () => {
    expect(isAuthId("")).toBe(false);
    expect(isAuthId("abc\ndef")).toBe(false);
    expect(isAuthId("x".repeat(129))).toBe(false);
  });
});
