import { describe, expect, it } from "vitest";
import { validatedColumns } from "./columns.ts";
import type { AnyFieldSpec } from "./field-spec.ts";

const fields: AnyFieldSpec[] = [
  { key: "firstName", kind: "text", group: "identity" },
  { key: "degree", kind: "lookup", group: "academic", set: "degrees" },
];

describe("validatedColumns", () => {
  it("returns a payload whose keys exactly match the declared field contract", () => {
    const payload = { firstName: "مریم", degree: "phd" };
    expect(validatedColumns<typeof payload>(fields, payload)).toBe(payload);
  });

  it("rejects a missing declared field before it reaches a database insert", () => {
    expect(() => validatedColumns(fields, { firstName: "مریم" })).toThrow(
      "validated payload missing field: degree",
    );
  });

  it("rejects an undeclared key before it reaches a database insert", () => {
    expect(() =>
      validatedColumns(fields, { firstName: "مریم", degree: "phd", tenantId: "foreign" }),
    ).toThrow("validated payload contains undeclared field: tenantId");
  });
});
