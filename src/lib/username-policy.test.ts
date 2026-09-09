import { describe, expect, it } from "vitest";
import {
  isValidUsernameCharacters,
  USERNAME_MAXIMUM_LENGTH,
  USERNAME_MINIMUM_LENGTH,
} from "./username-policy.ts";

describe("username policy", () => {
  it("accepts the characters shared by provisioning and sign-in", () => {
    expect(isValidUsernameCharacters("research.officer-2")).toBe(true);
    expect("a".repeat(USERNAME_MINIMUM_LENGTH)).toHaveLength(USERNAME_MINIMUM_LENGTH);
  });

  it("keeps the character validator separate from length validation", () => {
    expect(isValidUsernameCharacters("a".repeat(USERNAME_MAXIMUM_LENGTH + 1))).toBe(true);
    expect(isValidUsernameCharacters("کارمند")).toBe(false);
    expect(isValidUsernameCharacters("staff name")).toBe(false);
  });
});
