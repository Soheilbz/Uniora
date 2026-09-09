import { describe, expect, it } from "vitest";
import {
  parseParticipantImportMappingJson,
  parseParticipantImportProfileJson,
} from "./import-model.ts";

describe("participant import profile schema", () => {
  it("accepts only known mapping fields with string headers", () => {
    expect(
      parseParticipantImportMappingJson(
        JSON.stringify({ studentNumber: "Student ID", name: "Full name" }),
      ),
    ).toEqual({ studentNumber: "Student ID", name: "Full name" });
  });

  it("rejects malformed or structurally invalid mapping JSON", () => {
    expect(() => parseParticipantImportMappingJson("{")).toThrow();
    expect(() => parseParticipantImportMappingJson("[]")).toThrow();
    expect(() => parseParticipantImportMappingJson(JSON.stringify({ unknown: "x" }))).toThrow();
    expect(() => parseParticipantImportMappingJson(JSON.stringify({ name: 42 }))).toThrow();
  });

  it("requires an explicit supported conflict policy for durable profiles", () => {
    expect(
      parseParticipantImportProfileJson(
        JSON.stringify({ studentNumber: "Student ID" }),
        JSON.stringify({ conflictPolicy: "update" }),
      ),
    ).toEqual({ mapping: { studentNumber: "Student ID" }, conflictPolicy: "update" });
    expect(() => parseParticipantImportProfileJson("{}", "{}")).toThrow();
    expect(() =>
      parseParticipantImportProfileJson("{}", JSON.stringify({ conflictPolicy: "merge" })),
    ).toThrow();
    expect(() =>
      parseParticipantImportProfileJson(
        "{}",
        JSON.stringify({ conflictPolicy: "skip", unexpected: true }),
      ),
    ).toThrow();
  });
});
