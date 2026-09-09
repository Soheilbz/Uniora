import { describe, expect, it } from "vitest";
import { attendance } from "./sittings.ts";

describe("council attendance", () => {
  it("keeps absence factual while presenting a seated stand-in as present", () => {
    expect(attendance(["Member A", "Deputy B"], ["Member C"], { "Member C": "Deputy B" })).toEqual({
      present: [{ name: "Member A" }, { name: "Deputy B", standsFor: "Member C" }],
      absent: [],
    });
  });

  it("does not invent representation merely because a stand-in was assigned", () => {
    expect(attendance(["Member A"], ["Member C"], { "Member C": "Deputy B" })).toEqual({
      present: [{ name: "Member A" }],
      absent: ["Member C"],
    });
  });
});
