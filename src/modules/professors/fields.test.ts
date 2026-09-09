import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { professors } from "@/db/schema.ts";
import { VOCABULARY_SETS } from "@/db/vocabulary.ts";
import fa from "@/messages/fa.json" with { type: "json" };
import { PROFESSOR_FIELDS, PROFESSOR_GROUPS, PROFESSOR_LOOKUP_SETS } from "./fields.ts";

/**
 * `PROFESSOR_FIELDS` against the things it claims to describe.
 *
 * The same three claims the student register's guard makes, none of which the
 * compiler can check and each of which fails silently rather than loudly:
 *
 *   • every key is a real column — a typo writes nothing, and the value simply
 *     vanishes on save;
 *   • every field has a label — a missing catalogue key throws at render, but
 *     only on the one screen that shows that field;
 *   • every lookup names a vocabulary that exists — an unknown set yields an
 *     empty dropdown, which reads as an institution that has not filled its
 *     lists in yet.
 */

describe("PROFESSOR_FIELDS", () => {
  const columns = getTableColumns(professors);

  it("names only real, writable columns", () => {
    /*
     * The check that makes `asColumns()` in `actions.ts` safe. That cast tells
     * TypeScript the validated payload has the shape of an insert; this is what
     * makes the claim true.
     */
    for (const field of PROFESSOR_FIELDS) {
      expect(columns, `${field.key} is a column of professors`).toHaveProperty(field.key);
    }
  });

  it("never writes a column the form has no business owning", () => {
    /*
     * `id`, `tenantId`, `version` and the timestamps are the application's, not
     * the operator's. A form that posted `tenantId` would be a form that could
     * move a professor into another university.
     */
    const forbidden = ["id", "tenantId", "version", "createdAt", "updatedAt", "deletedAt"];
    for (const field of PROFESSOR_FIELDS) {
      expect(forbidden, `${field.key} is not an application-owned column`).not.toContain(field.key);
    }
  });

  it("gives every field a label and every hint a sentence", () => {
    const catalogue = (fa as unknown as { professors: Record<string, Record<string, string>> })
      .professors;

    for (const field of PROFESSOR_FIELDS) {
      expect(catalogue.field, `field.${field.key}`).toHaveProperty(field.key);
      if (field.hint) {
        const [, key] = field.hint.split(".");
        expect(catalogue.field, field.hint).toHaveProperty(key ?? field.hint);
      }
    }
  });

  it("gives every group a heading and a sentence", () => {
    const catalogue = (fa as unknown as { professors: Record<string, Record<string, string>> })
      .professors;
    for (const group of PROFESSOR_GROUPS) {
      expect(catalogue.group, `group.${group}`).toHaveProperty(group);
      expect(catalogue.section, `section.${group}Hint`).toHaveProperty(`${group}Hint`);
    }
  });

  it("puts every field in one of the four groups", () => {
    /* A field in a group nothing renders is a field that exists, validates and
       is never shown — the quietest way to lose a column. */
    for (const field of PROFESSOR_FIELDS) {
      expect(PROFESSOR_GROUPS, `${field.key} is in a rendered group`).toContain(
        field.group as never,
      );
    }
  });

  it("names only vocabularies the institution actually seeds", () => {
    for (const field of PROFESSOR_FIELDS) {
      if (field.kind !== "lookup" || !field.set) continue;
      expect(VOCABULARY_SETS, `${field.key} uses a known vocabulary`).toContain(field.set);
      expect(PROFESSOR_LOOKUP_SETS, `${field.set} is fetched for this form`).toContain(field.set);
    }
  });

  it("narrows only on a field that exists and is itself a lookup", () => {
    /*
     * `department` narrows on `faculty`. If the parent were misspelled the
     * dropdown would silently offer nothing, which looks exactly like a faculty
     * with no departments in it.
     */
    const byKey = new Map(PROFESSOR_FIELDS.map((field) => [field.key, field]));
    for (const field of PROFESSOR_FIELDS) {
      if (!field.narrowedBy) continue;
      const parent = byKey.get(field.narrowedBy);
      expect(parent, `${field.key} narrows on a field that exists`).toBeDefined();
      expect(parent?.kind, `${field.narrowedBy} is a lookup`).toBe("lookup");
    }
  });
});
