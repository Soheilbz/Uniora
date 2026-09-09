import { describe, expect, it } from "vitest";
import type { AuditEntry } from "./audit.ts";
import { groupAuditEntries, MIN_GROUP, NOTABLE } from "./audit-grouping.ts";

/**
 * Folding a bulk edit back into one line, and refusing to fold anything else.
 *
 * Both directions cost something and they are not symmetrical. Failing to fold
 * makes the screen unreadable after any bulk edit, which is loud. Folding too
 * eagerly hides an administrative act behind a disclosure triangle beside an
 * unrelated one — which is silent, and on the one screen in the product whose
 * whole job is that nothing is silent.
 */

let counter = 0;

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  counter += 1;
  return {
    id: `id-${counter}`,
    createdAt: new Date(2026, 0, 1),
    action: "update",
    entityType: "student",
    entityId: `record-${counter}`,
    actorId: "actor-1",
    actorName: "زهرا کریمی",
    changes: [{ field: "status", from: "enrolled", to: "graduated" }],
    ...over,
  };
}

describe("folding the trail", () => {
  it("folds a run of the same change into one group", () => {
    const groups = groupAuditEntries([entry(), entry(), entry(), entry()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(4);
    /* Drawn from the newest, which is the first of a newest-first list. */
    expect(groups[0]?.lead.id).toBe(groups[0]?.members[0]?.id);
  });

  it("leaves a run shorter than the threshold as ordinary rows", () => {
    const short = Array.from({ length: MIN_GROUP - 1 }, () => entry());
    const groups = groupAuditEntries(short);
    expect(groups).toHaveLength(short.length);
    expect(groups.every((group) => group.members.length === 1)).toBe(true);
  });

  it("does not fold two people making the same correction", () => {
    const groups = groupAuditEntries([
      entry({ actorId: "actor-1" }),
      entry({ actorId: "actor-2" }),
      entry({ actorId: "actor-1" }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("does not fold corrections that set different values", () => {
    const to = (value: string) =>
      entry({ changes: [{ field: "status", from: "enrolled", to: value }] });
    const groups = groupAuditEntries([to("graduated"), to("withdrawn"), to("graduated")]);
    expect(groups).toHaveLength(3);
  });

  it("does not fold events that name no record", () => {
    /*
     * An export, a sign-in, an import: three unrelated administrative acts that
     * happen to share an actor and an action shape. Folding them would put them
     * behind one triangle and call them one operation.
     */
    const oneOff = () => entry({ entityId: null, action: "data.export", changes: [] });
    const groups = groupAuditEntries([oneOff(), oneOff(), oneOff(), oneOff()]);
    expect(groups).toHaveLength(4);
  });

  it("only folds a run that is contiguous", () => {
    /*
     * Two identical corrections a month apart are two corrections. The list is
     * newest-first, so a bulk edit's rows sit together and these do not.
     */
    const same = () => entry();
    const other = () => entry({ action: "create", changes: [] });
    const groups = groupAuditEntries([same(), same(), same(), other(), same(), same(), same()]);
    expect(groups.map((group) => group.members.length)).toEqual([3, 1, 3]);
  });

  it("folds a run whose change objects arrived in a different key order", () => {
    /*
     * `readChanges` walks an object, and two rows written by one action can
     * still come back with their keys ordered differently. Without sorting,
     * «the same change» would silently mean «the same change, written the same
     * way» and a bulk edit of two fields would not fold at all.
     */
    const forward = () =>
      entry({
        changes: [
          { field: "status", from: "enrolled", to: "graduated" },
          { field: "degree", from: "masters", to: "doctorate" },
        ],
      });
    const reversed = () =>
      entry({
        changes: [
          { field: "degree", from: "masters", to: "doctorate" },
          { field: "status", from: "enrolled", to: "graduated" },
        ],
      });
    const groups = groupAuditEntries([forward(), reversed(), forward()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
  });

  it("keeps every event, folded or not", () => {
    /* The property the whole design rests on: the screen folds, it never drops.
       An auditor who opens every triangle must see the log entire. */
    const entries = [entry(), entry(), entry(), entry({ actorId: "actor-9" }), entry()];
    const groups = groupAuditEntries(entries);
    const seen = groups.flatMap((group) => group.members.map((member) => member.id));
    expect(seen.sort()).toEqual(entries.map((one) => one.id).sort());
  });

  it("colours few enough actions that the colour still means something", () => {
    /* A log where a third of the lines are amber is a log where amber means
       nothing. This is the check on that judgement, not on the list. */
    expect(NOTABLE.size).toBeGreaterThan(0);
    expect(NOTABLE.size).toBeLessThan(8);
    /* The everyday ones must never be in it. */
    for (const ordinary of ["create", "update", "delete"]) {
      expect(NOTABLE.has(ordinary), `"${ordinary}" is housekeeping`).toBe(false);
    }
  });
});
