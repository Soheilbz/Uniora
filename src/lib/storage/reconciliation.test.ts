import { describe, expect, it } from "vitest";
import { validatedStorageReconcileCandidateKeys } from "./reconciliation.ts";

describe("storage reconciliation candidates", () => {
  it("trims and deduplicates bounded candidate keys", () => {
    expect(validatedStorageReconcileCandidateKeys([" a/b ", "a/b", "c/d"])).toEqual(["a/b", "c/d"]);
  });

  it("rejects empty, oversized, newline and unbounded candidate sets", () => {
    expect(() => validatedStorageReconcileCandidateKeys([])).toThrow();
    expect(() => validatedStorageReconcileCandidateKeys(["a\nb"])).toThrow();
    expect(() => validatedStorageReconcileCandidateKeys(["x".repeat(2049)])).toThrow();
    expect(() =>
      validatedStorageReconcileCandidateKeys(Array.from({ length: 9 }, (_, i) => `x/${i}`)),
    ).toThrow();
  });
});
