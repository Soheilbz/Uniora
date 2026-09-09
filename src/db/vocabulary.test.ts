import { describe, expect, it } from "vitest";
import type { FilterDef, RegisterSpec } from "@/lib/register/spec.ts";
import {
  APPOINTMENT_FIELDS,
  DECISION_FIELDS,
  MEETING_FIELDS,
  RULING_FIELDS,
} from "@/modules/council/fields.ts";
import {
  APPOINTMENTS_REGISTER,
  DECISIONS_REGISTER,
  MEETINGS_REGISTER,
  RULINGS_REGISTER,
} from "@/modules/council/model.ts";
import { PROFESSOR_FIELDS } from "@/modules/professors/fields.ts";
import { PROFESSOR_REGISTER } from "@/modules/professors/model.ts";
import { STUDENT_FIELDS } from "@/modules/students/fields.ts";
import { STUDENT_REGISTER } from "@/modules/students/model.ts";
import { WORKSHOP_FIELDS, WORKSHOPS_REGISTER } from "@/modules/workshops/model.ts";
import { CODE_OWNED, VOCABULARY, VOCABULARY_SETS } from "./vocabulary.ts";

/**
 * Every vocabulary anything names, against the vocabularies that exist.
 *
 * ── Why this is one file and not one per register ───────────────────────────
 *
 * Each register already guards its own field list, and each of those guards was
 * written when that register was. The gap they leave is structural: a *new*
 * register arrives with no guard, and the omission is invisible — nothing fails,
 * because the missing test is the thing that would have failed. Two of the lists
 * below had no guard at all until this file existed.
 *
 * ── What an unknown set actually does ───────────────────────────────────────
 *
 * Nothing loud. A `lookup` field whose set nobody seeds renders as a select with
 * one option in it — «ثبت نشده» — and a filter whose set nobody seeds renders as
 * an empty dropdown. Both look like an institution that has not filled its lists
 * in yet, which is a real and common state, so nobody reports it. The record
 * then saves with the field empty.
 *
 * That is the whole selection criterion for a guard in this project: a mistake
 * that looks like a working feature.
 */

/** Anything with a code-defined vocabulary behind it. */
interface HasSet {
  key: string;
  kind?: string;
  set?: string | undefined;
}

const FIELD_LISTS: Record<string, readonly HasSet[]> = {
  STUDENT_FIELDS,
  PROFESSOR_FIELDS,
  MEETING_FIELDS,
  DECISION_FIELDS,
  RULING_FIELDS,
  APPOINTMENT_FIELDS,
  WORKSHOP_FIELDS,
};

const REGISTERS: Record<string, RegisterSpec> = {
  STUDENT_REGISTER,
  PROFESSOR_REGISTER,
  MEETINGS_REGISTER,
  DECISIONS_REGISTER,
  RULINGS_REGISTER,
  APPOINTMENTS_REGISTER,
  WORKSHOPS_REGISTER,
};

describe("the vocabularies everything resolves through", () => {
  it("defines each set exactly once", () => {
    /* Two entries under one name is a set whose contents depend on which one
       the seeder wrote last — and the seeder writes both, so the vocabulary
       ends up holding the union in an order nobody chose. */
    const counts = new Map<string, number>();
    for (const set of VOCABULARY_SETS) counts.set(set, (counts.get(set) ?? 0) + 1);
    expect([...counts].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("gives every entry a value and a label, and no value twice within a set", () => {
    for (const vocabulary of VOCABULARY) {
      const values = vocabulary.entries.map((entry) => entry.value);
      expect(new Set(values).size, `${vocabulary.set} has no repeated value`).toBe(values.length);
      for (const entry of vocabulary.entries) {
        expect(entry.value.trim(), `${vocabulary.set} entry has a value`).not.toBe("");
        expect(entry.label.trim(), `${vocabulary.set}.${entry.value} has a label`).not.toBe("");
      }
    }
  });

  it("nests only inside a set that exists, naming a parent that exists", () => {
    const byName = new Map(VOCABULARY.map((one) => [one.set, one]));
    for (const vocabulary of VOCABULARY) {
      for (const entry of vocabulary.entries) {
        if (!entry.parent) continue;
        expect(vocabulary.parentSet, `${vocabulary.set} names a parent set`).toBeDefined();
        const parent = byName.get(vocabulary.parentSet ?? "");
        expect(parent, `${vocabulary.parentSet} exists`).toBeDefined();
        expect(
          parent?.entries.map((one) => one.value),
          `${vocabulary.set}.${entry.value} nests under a real entry`,
        ).toContain(entry.parent);
      }
    }
  });

  it("is named only by fields whose vocabulary is seeded", () => {
    for (const [name, fields] of Object.entries(FIELD_LISTS)) {
      for (const field of fields) {
        if (field.kind !== "lookup") continue;
        expect(field.set, `${name}.${field.key} names a vocabulary`).toBeDefined();
        expect(VOCABULARY_SETS, `${name}.${field.key} → ${field.set}`).toContain(field.set);
      }
    }
  });

  it("is named only by filters whose vocabulary is seeded", () => {
    for (const [name, register] of Object.entries(REGISTERS)) {
      for (const filter of register.filters as readonly FilterDef[]) {
        /*
         * `null` is a filter with no reference list — its choices are read from
         * the column itself. Skipped rather than treated as a missing set: the
         * professors' specialisation is free text on the record and there is no
         * vocabulary for it to name.
         */
        if (filter.set === null) continue;
        expect(VOCABULARY_SETS, `${name} filter ${filter.key} → ${filter.set}`).toContain(
          filter.set,
        );
      }
    }
  });

  it("keeps every value the program branches on", () => {
    /*
     * The half of `CODE_OWNED` that can rot silently.
     *
     * The lookups screen refuses to withdraw these, so the office cannot lose
     * them — but nothing stops a *developer* renaming an entry here, or adding
     * a branch on a value that was never seeded. Either way the effect is the
     * same and equally quiet: `PROPOSAL_CATEGORIES` stops matching anything and
     * the minute's section (الف) comes out empty on a sitting that had four
     * proposals in it.
     */
    const byName = new Map(VOCABULARY.map((one) => [one.set, one]));
    for (const [set, owned] of Object.entries(CODE_OWNED)) {
      const vocabulary = byName.get(set);
      expect(vocabulary, `${set} is a vocabulary this software seeds`).toBeDefined();
      const values = vocabulary?.entries.map((entry) => entry.value) ?? [];
      for (const value of owned.required) {
        expect(values, `${set}.${value} is branched on and must exist`).toContain(value);
      }
    }
  });

  it("closes only sets whose members the code accounts for completely", () => {
    /*
     * A closed set means the office may add nothing to it, which is a real
     * restriction on their own vocabulary — so it has to be earned. The test of
     * "earned" is that the code names every member: if `required` is shorter
     * than the set, there is at least one value nothing branches on, and the
     * set is not being enumerated after all.
     */
    const byName = new Map(VOCABULARY.map((one) => [one.set, one]));
    for (const [set, owned] of Object.entries(CODE_OWNED)) {
      if (!owned.closed) continue;
      const values = byName.get(set)?.entries.map((entry) => entry.value) ?? [];
      expect(
        [...owned.required].sort(),
        `${set} is closed, so the code names every member`,
      ).toEqual([...values].sort());
    }
  });

  it("narrows a filter only on another filter of the same register", () => {
    /*
     * A filter narrowed by a key its own register does not offer can never be
     * satisfied: the parent's value is read from the URL, the URL never carries
     * it, and the child therefore offers nothing at all. That is
     * indistinguishable on screen from a faculty with no departments.
     */
    for (const [name, register] of Object.entries(REGISTERS)) {
      const keys = new Set(register.filters.map((one) => one.key));
      for (const filter of register.filters) {
        if (!filter.narrowedBy) continue;
        expect(keys, `${name} filter ${filter.key} narrows on a filter it has`).toContain(
          filter.narrowedBy,
        );
      }
    }
  });
});
