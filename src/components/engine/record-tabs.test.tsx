import { describe, expect, it } from "vitest";
import { render, text } from "../../../test-support/engine-render";
import { RecordTabs } from "./record-tabs";

/**
 * A record's tabs — and the one mistake that takes the page down.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * A record's tabs are assembled at request time: one per field group, plus
 * whatever else the page adds — the audit trail, the business of a sitting, the
 * board of a decision. Nothing in the type system says those values have to
 * differ, and the student register's field groups already contain one called
 * «history», which the audit tab also once claimed.
 *
 * The failure that produced was not a duplicated tab. It was
 * «Maximum update depth exceeded» — two tabs reporting themselves selected, two
 * panels mounted, and a re-render loop between them — with a message naming the
 * tabs library and nothing else. Four wrong hypotheses were tried before the
 * browser console named the real cause.
 */

const tab = (value: string, label: string) => ({ value, label, content: <p>{label} content</p> });

describe("RecordTabs", () => {
  it("puts every tab in the strip", () => {
    const markup = render(
      <RecordTabs tabs={[tab("identity", "شناسنامه"), tab("academic", "تحصیلی")]} />,
    );
    expect(text(markup)).toContain("شناسنامه");
    expect(text(markup)).toContain("تحصیلی");
  });

  it("opens the first tab and only the first", () => {
    /* One panel, not none and not two: a record page that opens on nothing
       reads as a record with no content in it. */
    const markup = render(
      <RecordTabs tabs={[tab("identity", "شناسنامه"), tab("academic", "تحصیلی")]} />,
    );
    expect(text(markup)).toContain("شناسنامه content");
    expect(text(markup)).not.toContain("تحصیلی content");
  });

  it("survives a record with no tabs at all", () => {
    /* Not a shape any page produces today, but `tabs[0]` is an optional access
       for a reason and a record whose every group is empty is not a crash. */
    expect(() => render(<RecordTabs tabs={[]} />)).not.toThrow();
  });

  it("refuses two tabs under one value, and names them", () => {
    /*
     * The exact collision that happened: a field group called «history» and an
     * audit tab that also called itself `history`. Thrown rather than left to
     * React, because the alternative is the same page going down a moment later
     * with a message that points at the tabs library.
     */
    expect(() =>
      render(
        <RecordTabs
          tabs={[
            tab("identity", "شناسنامه"),
            tab("history", "اطلاعات تکمیلی"),
            tab("history", "تاریخچه‌ی تغییرات"),
          ]}
        />,
      ),
    ).toThrow(/history/);
  });

  it("names both labels in the refusal, so the page can tell which two clashed", () => {
    let message = "";
    try {
      render(<RecordTabs tabs={[tab("history", "اطلاعات تکمیلی"), tab("history", "تاریخچه")]} />);
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).toContain("اطلاعات تکمیلی");
    expect(message).toContain("تاریخچه");
  });
});
