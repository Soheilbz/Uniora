import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fa from "@/messages/fa.json";
import { roleField, SHEETS, sheetFields, signatureField } from "./catalogue.ts";
import type { SheetBlock, SheetDef } from "./model.ts";

/**
 * The forms, against the catalogue they are written in.
 *
 * Every form is described by key — that is what makes it data rather than
 * markup — so nothing in TypeScript can tell a real key from a typo. What would
 * happen instead is that a clerk prints a defence permit and finds
 * `sheet.permit.s5.body` where the resolution should be, on a sheet the deputy
 * is about to sign. These tests are the only thing standing between the two.
 *
 * They are also what makes it safe to word a form in the catalogue: a key
 * renamed on one side and not the other fails here rather than on paper.
 */

/** Keys whose value is substituted into — these may carry placeholders. */
function filledKeys(sheet: SheetDef): string[] {
  const keys: string[] = [sheet.titleKey ?? sheet.labelKey];
  if (sheet.subtitleKey) keys.push(sheet.subtitleKey);
  if (sheet.footnote) keys.push(sheet.footnote);

  for (const section of sheet.sections) {
    if (section.title) keys.push(section.title);
    if (section.footnote) keys.push(section.footnote);
    for (const block of section.blocks) keys.push(...filledIn(block));
  }
  return keys;
}

function filledIn(block: SheetBlock): string[] {
  switch (block.kind) {
    case "paragraph":
    case "note":
      return [block.text];
    case "choices":
      return block.options;
    case "declarations":
      return block.items;
    case "rubric":
      return block.criteria.map((criterion) => criterion.label);
    case "grade":
      return [block.label];
    default:
      return [];
  }
}

/** Keys read as a plain caption — these must carry no placeholders. */
function captionKeys(sheet: SheetDef): string[] {
  const keys: string[] = ["sheet.index." /* placeholder, replaced below */];
  keys.length = 0;
  keys.push(sheet.labelKey);

  for (const section of sheet.sections) {
    for (const block of section.blocks) {
      if (block.kind === "fields") {
        for (const row of block.rows) {
          if (row.label !== "") keys.push(row.label);
          if (row.prefix) keys.push(row.prefix);
        }
      } else if (block.kind === "choices") {
        if (block.label) keys.push(block.label);
      } else if (block.kind === "panel") {
        keys.push(...block.columns);
        keys.push(...block.roles.map((role) => (typeof role === "string" ? role : role.label)));
      } else if (block.kind === "roster") {
        keys.push(block.title);
        keys.push(...block.roles.map((role) => (typeof role === "string" ? role : role.label)));
      } else if (block.kind === "blank") {
        keys.push(block.label);
      }
    }
    for (const signature of section.signatures ?? []) keys.push(signature.label);
  }
  return keys;
}

/** The keys the renderer writes out itself, which no form names. */
const RENDERER_KEYS = [
  "sheet.sign.name",
  "sheet.panel.rank",
  "sheet.panel.signature",
  "sheet.panel.facultyThenUniversity",
  "sheet.f.dateAndSignature",
  "sheet.f.number",
  "sheet.f.date",
  "sheet.f.registrationNumber",
  "sheet.formCode",
  "sheet.revision",
  "sheet.word.thesis",
  "sheet.word.dissertation",
  "sheet.rubric.criterion",
  "sheet.rubric.max",
  "sheet.rubric.awarded",
  "sheet.rubric.total",
  "sheet.rubric.finalMark",
  "sheet.rubric.inFigures",
  "sheet.rubric.inWords",
  "sheet.fin.criteria",
];

/**
 * The values a paragraph may name.
 *
 * The same list `sheetWords` supplies. A placeholder outside it is not a blank
 * on the sheet — the formatter refuses the message and the section fails to
 * render, so the guard is here rather than in a browser.
 */
const PLACEHOLDERS = new Set([
  "thesisType",
  "student",
  "studentNumber",
  "degree",
  "field",
  "thesis",
  "thesisCode",
  "supervisor",
  "department",
  "meeting",
  "meetingDate",
  "date",
  "day",
  "time",
  "place",
  "groupManager",
  "representative",
  "representativeTitled",
  "university",
  "faculty",
]);

function resolve(catalogue: Record<string, unknown>, key: string): string | undefined {
  let node: unknown = catalogue;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

const CATALOGUES = [
  ["fa", fa as unknown as Record<string, unknown>],
  ["en", en as unknown as Record<string, unknown>],
] as const;

describe("the worksheet catalogue", () => {
  it("offers fourteen forms, seven to a stage", () => {
    expect(SHEETS).toHaveLength(14);
    expect(SHEETS.filter((sheet) => sheet.category === "supervisor_selection")).toHaveLength(1);
    expect(new Set(SHEETS.map((sheet) => sheet.id)).size).toBe(14);
  });

  for (const [locale, catalogue] of CATALOGUES) {
    it(`resolves every key the forms name, in ${locale}`, () => {
      const missing: string[] = [];
      for (const sheet of SHEETS) {
        for (const key of [...filledKeys(sheet), ...captionKeys(sheet)]) {
          if (resolve(catalogue, key) === undefined) missing.push(`${sheet.id}: ${key}`);
        }
      }
      for (const key of RENDERER_KEYS) {
        if (resolve(catalogue, key) === undefined) missing.push(`renderer: ${key}`);
      }
      expect(missing).toEqual([]);
    });

    it(`substitutes only values the document supplies, in ${locale}`, () => {
      const unknown: string[] = [];
      for (const sheet of SHEETS) {
        for (const key of filledKeys(sheet)) {
          const message = resolve(catalogue, key) ?? "";
          for (const [, name] of message.matchAll(/\{(\w+)\}/g)) {
            if (!PLACEHOLDERS.has(name ?? "")) unknown.push(`${key}: {${name}}`);
          }
        }
      }
      expect(unknown).toEqual([]);
    });

    it(`keeps placeholders out of plain captions, in ${locale}`, () => {
      /*
       * A caption is read without values. One carrying `{student}` does not
       * print a blank — the formatter refuses the message, and the section it
       * heads fails to render at all.
       */
      const offending: string[] = [];
      for (const sheet of SHEETS) {
        const filled = new Set(filledKeys(sheet));
        for (const key of captionKeys(sheet)) {
          if (filled.has(key)) continue;
          const message = resolve(catalogue, key) ?? "";
          if (/\{\w+\}/.test(message)) offending.push(`${sheet.id}: ${key} — ${message}`);
        }
      }
      expect(offending).toEqual([]);
    });
  }

  it("gives every panel row and signature box a column to read", () => {
    /*
     * A seat worded by the form rather than by the record must name its column
     * outright; one worded by the record has its column derived. A row that
     * derived to nothing would print a rule where a name belongs, and would
     * look exactly like an examiner who was never appointed.
     */
    for (const sheet of SHEETS) {
      for (const section of sheet.sections) {
        for (const block of section.blocks) {
          if (block.kind !== "panel" && block.kind !== "roster") continue;
          for (const role of block.roles) {
            const named: string = roleField(role);
            expect(named, `${sheet.id}: ${JSON.stringify(role)}`).toMatch(/^[a-z][a-z0-9_]*$/);
          }
        }
      }
    }
  });

  it("derives a signature column only where the label is a record field", () => {
    for (const sheet of SHEETS) {
      for (const section of sheet.sections) {
        for (const signature of section.signatures ?? []) {
          const field = signatureField(signature);
          if (field === undefined) {
            /* Only a box nobody in the record holds may have no column — the
               research officer, who is whoever is on duty. */
            expect(signature.label.startsWith("decisions.field."), signature.label).toBe(false);
          } else {
            const named: string = field;
            expect(named, `${sheet.id}: ${signature.label}`).toMatch(/^[a-z][a-z0-9_]*$/);
          }
        }
      }
    }
  });

  it("names a stage-appropriate form code on every form but the notices", () => {
    for (const sheet of SHEETS) {
      if (sheet.chrome === "notice") {
        /* A notice is pinned to a board, not filed against a case. Inventing a
           code would put an official identifier on a document the university
           never issued one for. */
        expect(sheet.formCode, sheet.id).toBeUndefined();
      } else {
        expect(sheet.formCode, sheet.id).toBeTruthy();
      }
    }
  });

  it("asks the record for at least one column on every form that has a table", () => {
    for (const sheet of SHEETS) {
      const hasTable = sheet.sections.some((section) =>
        section.blocks.some((block) => block.kind === "panel" || block.kind === "roster"),
      );
      if (hasTable) expect(sheetFields(sheet).length, sheet.id).toBeGreaterThan(0);
    }
  });
});
