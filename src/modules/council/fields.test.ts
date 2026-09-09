import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { councilDecisions, councilMeetings, councilRulings } from "@/db/schema.ts";
import { VOCABULARY_SETS } from "@/db/vocabulary.ts";
import fa from "@/messages/fa.json" with { type: "json" };
import {
  BOARD_SEATS,
  COUNCIL_LOOKUP_SETS,
  type CouncilField,
  DECISION_FIELDS,
  DECISION_GROUPS,
  MEETING_FIELDS,
  MEETING_GROUPS,
  RULING_FIELDS,
  RULING_GROUPS,
  SUPERVISION_SEATS,
} from "./fields.ts";

/**
 * The council's field lists against the things they claim to describe.
 *
 * The same three claims the student register's test makes, for the same reason:
 * none is checkable by the compiler, and each fails silently. A field key that is
 * not a column writes nothing, so the value vanishes on save; a missing label
 * throws only on the one screen that shows that field; a lookup naming a set that
 * does not exist yields an empty dropdown, which looks like an institution that
 * has not filled its vocabularies in.
 */

const REGISTERS = [
  { name: "meetings", fields: MEETING_FIELDS, table: councilMeetings, labels: "council" },
  { name: "decisions", fields: DECISION_FIELDS, table: councilDecisions, labels: "decisions" },
  { name: "rulings", fields: RULING_FIELDS, table: councilRulings, labels: "decisions" },
] as const;

const catalogue = fa as unknown as Record<string, { field: Record<string, string> }>;

describe.each(REGISTERS)("$name fields", ({ fields, table, labels }) => {
  const columns = getTableColumns(table);

  it("names only real, writable columns", () => {
    for (const field of fields) {
      expect(columns, `${field.key} is a column`).toHaveProperty(field.key);
    }
  });

  it("never writes a column the form has no business owning", () => {
    // `tenantId` in particular: a form field by that name would be a way to file
    // a record into another university.
    const forbidden = ["id", "tenantId", "version", "createdAt", "updatedAt", "deletedAt"];
    for (const key of forbidden) {
      expect(fields.map((field: CouncilField) => field.key)).not.toContain(key);
    }
  });

  it("has a Persian label for every field", () => {
    for (const field of fields) {
      expect(catalogue[labels]?.field, `${field.key} has a label`).toHaveProperty(field.key);
    }
  });

  it("has no duplicate keys", () => {
    const keys = fields.map((field: CouncilField) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the council's vocabularies and groups", () => {
  it("points every lookup at a vocabulary that is seeded", () => {
    for (const set of COUNCIL_LOOKUP_SETS) {
      expect(VOCABULARY_SETS, `${set} is a seeded vocabulary`).toContain(set);
    }
  });

  it("puts every field in a declared group", () => {
    const declared = [
      [MEETING_FIELDS, MEETING_GROUPS],
      [DECISION_FIELDS, DECISION_GROUPS],
      [RULING_FIELDS, RULING_GROUPS],
    ] as const;

    for (const [fields, groups] of declared) {
      for (const field of fields) {
        expect(groups, `${field.key} is in group "${field.group}"`).toContain(field.group);
      }
    }
  });

  it("keeps archival meeting times as clock text rather than strict HH:MM", () => {
    for (const fields of [MEETING_FIELDS, DECISION_FIELDS, RULING_FIELDS]) {
      const meetingTime = fields.find((field) => field.key === "meetingTime");
      expect(meetingTime?.format).toBe("clockText");
    }
  });

  it("has a Persian heading and hint for every group", () => {
    const council = fa as unknown as {
      council: { group: Record<string, string>; section: Record<string, string> };
      decisions: { group: Record<string, string>; section: Record<string, string> };
    };
    for (const group of MEETING_GROUPS) {
      expect(council.council.group).toHaveProperty(group);
      expect(council.council.section).toHaveProperty(`${group}Hint`);
    }
    for (const group of DECISION_GROUPS) {
      expect(council.decisions.group).toHaveProperty(group);
      expect(council.decisions.section).toHaveProperty(`${group}Hint`);
    }
  });
});

describe("the board's seats", () => {
  it("names fields that exist on the decision", () => {
    /*
     * `SUPERVISION_SEATS` and `BOARD_SEATS` drive the duplicate-name check in
     * the save action. A seat naming a field that is not on the record is a seat
     * that check silently skips — so the one collision it exists to catch would
     * go through.
     */
    const keys = new Set(DECISION_FIELDS.map((field) => field.key));
    for (const seat of [...SUPERVISION_SEATS, ...BOARD_SEATS]) {
      expect(keys, `${seat} is a decision field`).toContain(seat);
    }
  });

  it("keeps the two sets disjoint", () => {
    // A name in both would be checked twice and, worse, would suggest the
    // examining board and the supervision are the same seats.
    const supervision = new Set<string>(SUPERVISION_SEATS);
    for (const seat of BOARD_SEATS) expect(supervision.has(seat)).toBe(false);
  });
});
