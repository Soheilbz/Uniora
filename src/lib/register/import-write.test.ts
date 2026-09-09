import { describe, expect, it } from "vitest";
import { rollbackTouchesRestrictedField } from "./import-rollback.ts";

describe("import rollback field permissions", () => {
  it("blocks rollback when the audit restore would change a restricted field", () => {
    expect(rollbackTouchesRestrictedField({ surname: "A", degree: "phd" }, ["degree"])).toBe(true);
  });

  it("allows rollback when restricted fields are absent", () => {
    expect(rollbackTouchesRestrictedField({ surname: "A" }, ["degree"])).toBe(false);
  });

  it("has no field restriction for callers allowed to change all imported fields", () => {
    expect(rollbackTouchesRestrictedField({ degree: "phd" }, [])).toBe(false);
  });
});
