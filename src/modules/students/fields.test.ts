import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { students } from "@/db/schema.ts";
import { VOCABULARY_SETS } from "@/db/vocabulary.ts";
import fa from "@/messages/fa.json" with { type: "json" };
import { FIELD_GROUPS, labelKey, STUDENT_FIELDS, STUDENT_LOOKUP_SETS } from "./fields.ts";

/**
 * `STUDENT_FIELDS` against the things it claims to describe.
 *
 * Three claims, none of which the compiler can check, and each of which fails
 * silently rather than loudly:
 *
 *   • every key is a real column — a typo writes nothing, and the value simply
 *     vanishes on save;
 *   • every field has a label — a missing catalogue key throws at render, but
 *     only on the one screen that shows that field;
 *   • every lookup names a vocabulary that exists — an unknown set yields an
 *     empty dropdown, which looks like an institution that has not filled its
 *     vocabularies in yet.
 *
 * These run in the unit suite because none of them needs a database: the table
 * definition, the catalogue and the vocabulary list are all just values.
 */

describe("STUDENT_FIELDS", () => {
  const columns = getTableColumns(students);

  it("names only real, writable columns", () => {
    /*
     * The check that makes `asColumns()` in `actions.ts` safe. That cast tells
     * TypeScript the validated payload has the shape of an insert; this is what
     * makes the claim true.
     */
    for (const field of STUDENT_FIELDS) {
      expect(columns, `${field.key} is a column of students`).toHaveProperty(field.key);
    }
  });

  it("never writes a column the form has no business owning", () => {
    // `id`, `tenantId` and `version` are the application's, not the operator's.
    // A form field named `tenantId` would be a way to file a record into another
    // university.
    const forbidden = [
      "id",
      "tenantId",
      "version",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "searchText",
    ];
    for (const key of forbidden) {
      expect(STUDENT_FIELDS.map((field) => field.key)).not.toContain(key);
    }
  });

  it("has a Persian label for every field", () => {
    const labels = (fa as { students: { field: Record<string, string> } }).students.field;
    for (const field of STUDENT_FIELDS) {
      const key = labelKey(field).replace(/^field\./, "");
      expect(labels, `${field.key} has a label`).toHaveProperty(key);
    }
  });

  it("has a Persian label for every group, and a hint", () => {
    const students_ = fa as {
      students: { group: Record<string, string>; section: Record<string, string> };
    };
    for (const group of FIELD_GROUPS) {
      expect(students_.students.group).toHaveProperty(group);
      expect(students_.students.section).toHaveProperty(`${group}Hint`);
    }
  });

  it("points every lookup at a vocabulary that is seeded", () => {
    for (const set of STUDENT_LOOKUP_SETS) {
      expect(VOCABULARY_SETS, `${set} is a seeded vocabulary`).toContain(set);
    }
  });

  it("names an existing field as the one that narrows a nested lookup", () => {
    const keys = new Set(STUDENT_FIELDS.map((field) => field.key));
    for (const field of STUDENT_FIELDS) {
      if (!field.narrowedBy) continue;
      expect(keys, `${field.key} is narrowed by ${field.narrowedBy}`).toContain(field.narrowedBy);
    }
  });

  it("resolves every hint to a real catalogue entry", () => {
    const labels = (fa as { students: { field: Record<string, string> } }).students.field;
    for (const field of STUDENT_FIELDS) {
      if (!field.hint) continue;
      expect(labels).toHaveProperty(field.hint.replace(/^field\./, ""));
    }
  });

  it("puts every field in a declared group", () => {
    for (const field of STUDENT_FIELDS) {
      expect(FIELD_GROUPS).toContain(field.group);
    }
  });

  it("has no duplicate keys", () => {
    const keys = STUDENT_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
