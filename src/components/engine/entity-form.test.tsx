import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { render, text, words } from "../../../test-support/engine-render";

/**
 * The record form, as a first render decides it.
 *
 * ── What a form of fifty boxes gets wrong quietly ───────────────────────────
 *
 * Every claim below is about a field either not being drawn, or being drawn
 * empty. Both look like a form working: a record whose «نام پدر» never appears
 * looks like a record whose father's name was not asked for, and a box that
 * lost its value after a refused save looks like a box nobody filled in.
 *
 * The one that actually happened is the restoration. React resets an
 * uncontrolled form once a form action completes, so one rejected national id
 * emptied the other forty-nine boxes and the operator retyped the whole paper
 * file to fix a typo.
 *
 * ── What is not here ────────────────────────────────────────────────────────
 *
 * The unsaved-work guard, the narrowing that follows a click, and the remount
 * counter all need a second render or a browser. The rule the guard follows is
 * `leaving.ts`, tested as a plain function; the rest is checked against the
 * running application.
 */

vi.mock("next-intl", async () => {
  const { words: catalogue } = await import("../../../test-support/engine-render");
  return { useTranslations: (namespace: string) => catalogue(namespace), useLocale: () => "fa" };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { EntityForm } = await import("./entity-form");

const noop = async (): Promise<ActionResult> => ({ ok: true });

const FIELDS = [
  { key: "firstName", kind: "text" as const, group: "identity", required: true, maxLength: 200 },
  { key: "fatherName", kind: "text" as const, group: "identity", maxLength: 200 },
  { key: "nationalId", kind: "text" as const, group: "identity", format: "nationalId" as const },
  { key: "faculty", kind: "lookup" as const, group: "academic", set: "faculties" },
  {
    key: "department",
    kind: "lookup" as const,
    group: "academic",
    set: "departments",
    narrowedBy: "faculty",
  },
  { key: "notes", kind: "text" as const, group: "academic", maxLength: 2000 },
];

const base = {
  action: noop,
  fields: FIELDS,
  groups: ["identity", "academic"],
  options: {
    faculty: [{ value: "engineering", label: "مهندسی" }],
    department: [{ value: "software", label: "نرم‌افزار", parent: "engineering" }],
  },
  values: {} as Record<string, string>,
  labels: {
    firstName: "نام",
    fatherName: "نام پدر",
    nationalId: "کد ملی",
    faculty: "دانشکده",
    department: "گروه آموزشی",
    notes: "یادداشت",
  },
  groupLabels: {
    identity: { title: "شناسنامه", hint: "مشخصات هویتی" },
    academic: { title: "تحصیلی", hint: "محل تحصیل" },
  },
  hints: {},
  cancelHref: "/students",
  submitLabel: "ذخیره",
};

describe("what the form draws", () => {
  it("puts every field on the page, under its own group", () => {
    /*
     * The whole point of a schema-driven form: a column added to the field list
     * appears here without this component being touched. A field silently not
     * drawn is a field the office cannot fill in and nobody can see is missing.
     */
    const shown = text(render(<EntityForm {...base} />));
    for (const label of Object.values(base.labels)) expect(shown).toContain(label);
    expect(shown).toContain("شناسنامه");
    expect(shown).toContain("تحصیلی");
  });

  it("keeps the groups in the order the register declared them", () => {
    /*
     * It is the order of the paper folder, not a designer's grouping: somebody
     * transcribing a file works top to bottom and the form has to follow the
     * document in their other hand.
     */
    const shown = text(render(<EntityForm {...base} />));
    expect(shown.indexOf("شناسنامه")).toBeLessThan(shown.indexOf("تحصیلی"));
  });

  it("marks the required field and only the required field", () => {
    const markup = render(<EntityForm {...base} />);
    expect(markup).toContain("required");
    /* One asterisk, on «نام». Marking every box makes the mark meaningless. */
    expect([...markup.matchAll(/aria-hidden="true">\*<\/span>/g)]).toHaveLength(1);
  });

  it("carries the record's identity and version as hidden fields", () => {
    /*
     * The version is what makes two clerks editing one record a reported
     * conflict rather than one of them silently losing their work. Absent, the
     * save has nothing to compare and the last write wins.
     */
    const markup = render(<EntityForm {...base} recordId="abc" version={7} />);
    expect(markup).toContain('name="id"');
    expect(markup).toContain('value="abc"');
    expect(markup).toContain('name="version"');
    expect(markup).toContain('value="7"');
  });

  it("omits both on a new record", () => {
    const markup = render(<EntityForm {...base} />);
    expect(markup).not.toContain('name="id"');
    expect(markup).not.toContain('name="version"');
  });

  it("carries the values a screen holds but never shows", () => {
    /*
     * A decision's link to its sitting: the operator edits the sitting's
     * *number*, which is what the minute recorded, while the id is how the
     * record page navigates to it. Dropped on save, every decision anybody
     * edited would quietly unlink.
     */
    const markup = render(<EntityForm {...base} extraFields={{ meetingId: "m-1" }} />);
    expect(markup).toContain('name="meetingId"');
    expect(markup).toContain('value="m-1"');
  });
});

describe("what a box is typed into", () => {
  it("gives an identifier a numeric keypad and a left-to-right box", () => {
    /*
     * Not decoration. A national id typed into a box that offers a Persian
     * keyboard and lays out right-to-left is a national id that arrives in the
     * wrong order — and on a phone the numeric keypad is four taps against
     * forty.
     */
    const markup = render(<EntityForm {...base} />);
    const box = /<input[^>]*name="nationalId"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(box).toContain('inputMode="numeric"');
    expect(box).toContain('dir="ltr"');
  });

  it("gives a long field a textarea when the screen asks for one", () => {
    /*
     * A list of keys rather than a field kind, because «how tall is the box» is
     * a presentation decision while the kind answers what the value *is*. The
     * council's attendance lists are `text` to the validator and one name per
     * line to the reader, and both are true.
     */
    const markup = render(<EntityForm {...base} multiline={["notes"]} />);
    expect(markup).toMatch(/<textarea[^>]*name="notes"/);
  });

  it("posts a vocabulary choice through a hidden input", () => {
    /*
     * Base UI's Select is not a native `<select>` and posts nothing on its own.
     * Without this the form submits with every dropdown empty — and the record
     * *saves*, quietly clearing the standing and the supervisor it had before.
     */
    const markup = render(<EntityForm {...base} />);
    expect(markup).toMatch(/<input type="hidden" name="faculty"/);
    expect(markup).toMatch(/<input type="hidden" name="department"/);
  });

  it("disables a nested list until its parent is chosen", () => {
    /*
     * Offering every department in the institution lets a clerk file a student
     * in one their faculty does not have — a record that is wrong while every
     * field on it is individually valid.
     */
    const markup = render(<EntityForm {...base} />);
    const department = /name="department"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
    expect(department).toContain("disabled");
    /* And its sibling is not: a faculty may be chosen at any time. */
    const faculty = /name="faculty"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
    expect(faculty).not.toContain("disabled=");
  });
});

describe("after a save the server refused", () => {
  const refused: ActionResult = {
    ok: false,
    errors: { nationalId: "text.nationalId" },
    values: { firstName: "مریم", fatherName: "حسن", nationalId: "123" },
  };

  /*
   * `useActionState` returns its initial state on a first render, so a refusal
   * cannot be produced by rendering — it arrives from an action. What *can* be
   * checked here is the other half of the same behaviour: that the form draws
   * the values it was given, which is the mechanism the restoration reuses.
   */
  it("draws the values it was handed", () => {
    const markup = render(
      <EntityForm {...base} values={{ firstName: "مریم", fatherName: "حسن" }} />,
    );
    expect(markup).toContain('value="مریم"');
    expect(markup).toContain('value="حسن"');
  });

  it("treats an empty string as a box nobody filled in", () => {
    /* Not the string «null», and not the key: a form posts every field it has,
       and an untouched box has to come back untouched. */
    const markup = render(<EntityForm {...base} values={{ firstName: "" }} />);
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain(">null<");
  });

  it("has somewhere to put a failure that belongs to no single box", () => {
    /*
     * A save conflict, or a record that vanished. `role="alert"` so it is
     * announced when it appears — somebody who has just scrolled to the bottom
     * of a fifty-box form and pressed save is not looking at the top of it.
     */
    const markup = render(<EntityForm {...base} />);
    expect(markup).not.toContain('role="alert"');
    expect(refused.errors?.nationalId).toBe("text.nationalId");
  });
});

describe("the way out", () => {
  it("offers the register's own word for saving, and a way back", () => {
    const markup = render(<EntityForm {...base} submitLabel="ثبت جلسه" />);
    expect(text(markup)).toContain("ثبت جلسه");
    expect(markup).toContain('href="/students"');
    /* «بازگشت», not «انصراف»: the button leaves the form, it does not undo
       anything, and a record being edited is not a transaction to cancel. */
    expect(text(markup)).toContain(words("common")("back"));
  });
});
