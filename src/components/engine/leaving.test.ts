import { describe, expect, it } from "vitest";
import { type Click, type ClickedLink, interceptedHref } from "./leaving.ts";

/**
 * Which clicks the unsaved-work guard stands in front of.
 *
 * The rule is worth testing on its own because *every* case here is one
 * somebody would otherwise find the hard way, and half of them are the guard
 * being wrong rather than absent. A confirmation in front of a middle click is
 * worse than no confirmation at all: it interrupts the one gesture that was
 * already safe, and it teaches people to click through the dialog — which is
 * exactly the habit that loses the record it exists to protect.
 */

const plain: Click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

function link(href: string | null, extra: Partial<ClickedLink> = {}): ClickedLink {
  return {
    getAttribute: (name) => (name === "href" ? href : null),
    hasAttribute: () => false,
    target: "",
    ...extra,
  };
}

describe("what the unsaved guard asks about", () => {
  it("stops an ordinary click on a link out of the form", () => {
    expect(interceptedHref(plain, link("/students"))).toBe("/students");
  });

  it("lets a click through when it hit no link at all", () => {
    /* Every click in the document reaches this handler — typing in a box,
       ticking a checkbox, pressing save. Only a link is a navigation. */
    expect(interceptedHref(plain, null)).toBeNull();
    expect(interceptedHref(plain, undefined)).toBeNull();
  });

  it("lets every gesture that opens a second tab through", () => {
    /*
     * The page — and the work on it — stays exactly where it is, so there is
     * nothing to confirm. Getting this wrong is the failure mode that matters:
     * a dialog in front of a safe gesture is how people learn to dismiss the
     * dialog without reading it.
     */
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(
        interceptedHref({ ...plain, [modifier]: true }, link("/students")),
        `${modifier} opens elsewhere and leaves this page alone`,
      ).toBeNull();
    }
    expect(interceptedHref({ ...plain, button: 1 }, link("/students"))).toBeNull();
  });

  it("lets an anchor on this very page through", () => {
    /* «Skip to content» is not leaving the form. */
    expect(interceptedHref(plain, link("#main-content"))).toBeNull();
  });

  it("lets a link that opens in a new tab through", () => {
    expect(interceptedHref(plain, link("/print/users", { target: "_blank" }))).toBeNull();
  });

  it("lets a download through", () => {
    /* An export does not navigate at all — the page is still there when the
       file lands. */
    expect(
      interceptedHref(plain, link("/students/export.csv", { hasAttribute: () => true })),
    ).toBeNull();
  });

  it("lets a link with no destination through", () => {
    /* A button rendered as an anchor by a component library. */
    expect(interceptedHref(plain, link(null))).toBeNull();
  });
});
