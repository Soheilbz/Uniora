import { describe, expect, it } from "vitest";
import { platformNextPath } from "./platform-viewer.ts";

describe("platformNextPath", () => {
  it("keeps only local platform paths", () => {
    expect(platformNextPath("/platform")).toBe("/platform");
    expect(platformNextPath("/platform/security/challenge?next=%2Fplatform")).toBe(
      "/platform/security/challenge?next=%2Fplatform",
    );
    expect(platformNextPath("/students")).toBe("/platform");
    expect(platformNextPath("//attacker.example/platform")).toBe("/platform");
    expect(platformNextPath("https://attacker.example/platform")).toBe("/platform");
  });
});
