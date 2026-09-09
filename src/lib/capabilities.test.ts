import { describe, expect, it } from "vitest";
import {
  ADMINISTRATOR_TIER,
  CAPABILITIES,
  isCapability,
  ORDINARY_TIER,
  ROLE_TIERS,
  SENIOR_TIER,
  tierName,
  tierRank,
} from "./capabilities";

describe("capabilities", () => {
  it("rejects a name that is not in the list", () => {
    /*
     * The reason the list is closed. A misspelled capability in a `has()` check
     * is a permission that never matches — either a screen nobody can open, or,
     * if the check is written the other way round, a guard everybody passes.
     */
    expect(isCapability("students.view")).toBe(true);
    expect(isCapability("students.veiw")).toBe(false);
    expect(isCapability("*")).toBe(false);
    expect(isCapability(undefined)).toBe(false);
  });

  it("has no duplicates", () => {
    // A duplicate is harmless until somebody removes "the" entry and one copy
    // of it survives, which reads as a capability that cannot be revoked.
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("orders the tiers, and the order is the meaning", () => {
    expect(ORDINARY_TIER).toBeLessThan(SENIOR_TIER);
    expect(SENIOR_TIER).toBeLessThan(ADMINISTRATOR_TIER);
  });

  it("treats an unknown tier as the lowest one", () => {
    /*
     * Fail closed. A row whose `tier` column holds something the code has never
     * heard of — a hand-edited database, a rolled-back migration — must not be
     * read as "the highest tier", which is what any scheme that sorts unknowns
     * last would do.
     */
    expect(tierRank("archivist")).toBe(ORDINARY_TIER);
    expect(tierRank("")).toBe(ORDINARY_TIER);
    expect(tierName(99)).toBe("ordinary");
    expect(tierName(-1)).toBe("ordinary");
  });

  it("round-trips every tier it does know", () => {
    for (const tier of ROLE_TIERS) {
      expect(tierName(tierRank(tier))).toBe(tier);
    }
  });
});
