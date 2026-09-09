import { describe, expect, it } from "vitest";
import { same, sameJson } from "@/lib/register/changes.ts";

/**
 * What counts as a change, and therefore what the audit trail records.
 *
 * The stakes are the trail's readability. Every field this says differs becomes
 * a line under an entry on the record's history tab, so a rule that is too
 * eager turns one edited field into an entry naming five — and a history nobody
 * can skim is a history nobody opens, which is the whole value of keeping one.
 *
 * The other direction is worse and rarer: a rule that is too lax drops a real
 * edit out of the record entirely.
 */

describe("what counts as a change", () => {
  it("treats an unticked box and an unrecorded one as one state", () => {
    /*
     * The defect this was written for. A checkbox posts nothing when unticked,
     * so the form always sends `false`, while a record written before that
     * field existed holds `null`. Read as different, every unticked box on an
     * older record was logged as an edit: one save of one field wrote a trail
     * entry naming four.
     */
    expect(same("boolean", null, false)).toBe(true);
    expect(same("boolean", undefined, false)).toBe(true);
    expect(same("boolean", false, null)).toBe(true);
  });

  it("still sees a box being ticked or cleared", () => {
    expect(same("boolean", null, true)).toBe(false);
    expect(same("boolean", false, true)).toBe(false);
    expect(same("boolean", true, false)).toBe(false);
  });

  it("keeps «not recorded» distinct from a value on text and numbers", () => {
    /*
     * The opposite call from the boolean one, and deliberately. A blank name is
     * not the name «», and a missing GPA is not a GPA of nought — filling one
     * in is a real edit and belongs on the record.
     */
    expect(same("text", null, "احمدی")).toBe(false);
    expect(same("number", null, 0)).toBe(false);
    expect(same("text", "احمدی", null)).toBe(false);
  });

  it("treats blank, null and undefined alike on text", () => {
    /* A form posts an untouched box as `""`; the column holds `null`. Neither
       is a value, and swapping one for the other is not an edit. */
    expect(same("text", null, "")).toBe(true);
    expect(same("text", "", undefined)).toBe(true);
  });

  it("compares a number by value, not by how it was written", () => {
    /*
     * A GPA arrives from PostgreSQL as the string «17.50» and from the form as
     * the number 17.5. Compared as text those differ, and every save of an
     * untouched record would log a change to a field nobody touched.
     */
    expect(same("number", "17.50", 17.5)).toBe(true);
    expect(same("number", "17.50", 17.75)).toBe(false);
  });

  it("compares text by its own value", () => {
    expect(same("text", "شیراز", "شیراز")).toBe(true);
    expect(same("text", "شیراز", "مشهد")).toBe(false);
  });

  it("compares json objects independent of key order but keeps array order", () => {
    expect(sameJson({ b: "2", a: "1" }, { a: "1", b: "2" })).toBe(true);
    expect(sameJson(["A", "B"], ["B", "A"])).toBe(false);
    expect(sameJson({ seat: ["A", "B"] }, { seat: ["A", "B"] })).toBe(true);
  });
});
