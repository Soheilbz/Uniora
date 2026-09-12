import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetDocument } from "@/components/worksheets/sheet-document";
import type { LookupEntry, LookupTable } from "@/lib/lookups.ts";
import fa from "@/messages/fa.json" with { type: "json" };
import { SHEET_BY_ID, SHEETS } from "./catalogue.ts";
import type { Letterhead, PanelRegister } from "./queries.ts";

/**
 * What the fourteen worksheets put on A4.
 *
 * ── Why a form gets a guard nothing else has ────────────────────────────────
 *
 * A worksheet is an administrative instrument. It goes into a student's file and
 * it is signed, so the office's copies have to agree with each other year on
 * year — a reworded heading, a moved signature block or a different date format
 * makes this build's paperwork inconsistent with everything already filed.
 *
 * Nothing else in this suite would notice. The catalogue stays well-formed, the
 * types are satisfied, the page renders, and one edit to a shared block renderer
 * changes all fourteen documents at once. That last part is the whole argument:
 * these forms have no separate templates to review, so the review has to be a
 * test.
 *
 * ── Controlled print contracts ─────────────────────────────────────────────
 *
 * `print-goldens/*.txt` are reviewed reference outputs for the current Web
 * application. They change only when the corresponding university instrument
 * is formally revised; an unexpected diff is therefore a print-contract
 * regression, not a snapshot to refresh automatically.
 *
 * ── Digits are Persian here and ASCII on the council's papers ───────────────
 *
 * Deliberately, and both are version 1's. A worksheet is a Persian instrument
 * throughout — «۶۵۶۴۴», «۱۴۰۵/۰۲/۰۸» — while the council's minute quotes the
 * register's own ASCII. The two goldens hold the two rules, which is the only
 * way a shared renderer can be stopped from unifying them.
 */

const GOLDEN = "src/modules/worksheets/print-goldens";

/*
 * One record, the reference's own. Every one of the fourteen forms is rendered
 * for it, so a change to a shared block shows up on every sheet that uses it
 * rather than on whichever one somebody happened to open.
 */
const CASE: Record<string, unknown> = {
  meeting_number: "670",
  meeting_date: "2025-12-21",
  meeting_day: "monday",
  meeting_time: "10:00",
  meeting_location: "سالن شورا",
  council_notes: "بدون یادداشت",
  student_name: "نادیا فیجی وری",
  student_number: "4002612042",
  education_level: "master",
  field_of_study: "fs1",
  thesis_title: "بررسی اثر ضدمیکروبی پست‌بیوتیک‌ها",
  thesis_code: "65644",
  research_type: "rt1",
  primary_supervisor: "عبداله جمشیدی",
  secondary_supervisor: "محمد محسن‌زاده",
  third_supervisor: "سعید خانزادی",
  first_advisor: "بهروز فتحی",
  second_advisor: "امیر افخمی",
  third_advisor: "رضا نراقی",
  reviewer1: "علی مصباح",
  reviewer2: "حسین کاظمی",
  reviewer3: "مهدی رضوی",
  reviewer4_invited: "نیما شریفی",
  graduate_studies_representative: "محسن مالکی",
  faculty_dean: "احمد رئیسی",
  department_council: "بهداشت مواد غذایی",
  education_office: "زهرا آموزشی",
  educational_cultural_deputy: "کاوه فرهنگی",
  research_deputy: "سعید پژوهشی",
  department_head: "مجید بخشی",
  group_manager: "محمد محسن‌زاده",
  defense_meeting_date: "2026-04-28",
  defense_meeting_day: "tuesday",
  defense_meeting_time: "11:30",
  /* «آمفی‌تئاتر», not «دانشکده آمفی‌تئاتر»: the sentence supplies «در محل
     دانشکده» itself, and a value carrying the word again prints it twice. */
  defense_meeting_location: "آمفی‌تئاتر",
  achievements: "یک مقاله ISI",
};

/* Flat sets: none of the vocabularies these forms read is a nested one, so
   every entry is its own root. */
const VOCABULARY: Record<string, { value: string; label: string }[]> = {
  degrees: [{ value: "master", label: "کارشناسی ارشد" }],
  fields_of_study: [{ value: "fs1", label: "بهداشت مواد غذایی" }],
  research_types: [{ value: "rt1", label: "تجربی" }],
  weekdays: [
    { value: "monday", label: "دوشنبه" },
    { value: "tuesday", label: "سه‌شنبه" },
  ],
};

const lookups: LookupTable = new Map(
  Object.entries(VOCABULARY).map(([set, entries]) => [
    set,
    entries.map<LookupEntry>((entry, index) => ({
      ...entry,
      id: entry.value,
      parentId: null,
      position: index,
      retired: false,
    })),
  ]),
);

/** Everybody on the panel is on staff, at one rank, at one university. */
const register: PanelRegister = new Map(
  [
    "عبداله جمشیدی",
    "محمد محسن‌زاده",
    "سعید خانزادی",
    "بهروز فتحی",
    "امیر افخمی",
    "رضا نراقی",
    "علی مصباح",
    "حسین کاظمی",
    "مهدی رضوی",
    "نیما شریفی",
    "محسن مالکی",
    "مجید بخشی",
    "احمد رئیسی",
    "سعید پژوهشی",
    "زهرا آموزشی",
    "کاوه فرهنگی",
  ].map((name) => [name, { rank: "دانشیار", affiliation: "دانشگاه فردوسی مشهد" }]),
);

/** Unnamed, which is the state the reference corpus was rendered in. */
const letterhead: Letterhead = {
  name: "",
  faculty: "",
  crest: "",
  named: false,
  readyForOfficialPrint: false,
};

const say = (path: string): string => {
  let node: unknown = fa;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown>)?.[part];
  }
  return typeof node === "string" ? node : path;
};

/** ICU's simple argument form is all these sheets use. */
const translate = (key: string, values?: Record<string, string>): string =>
  say(key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? `{${name}}`);

/**
 * Block-level tags, which is where a printed line ends.
 *
 * Line boundaries are an artefact of which elements a build happens to make
 * block-level — a signature box ruled as two divs and one as a flex row print
 * identically — so this list matches the reference's exactly. It is what makes
 * the two products' output comparable at all.
 */
const BLOCK = new Set([
  "div",
  "dd",
  "dl",
  "dt",
  "h1",
  "h2",
  "h3",
  "h4",
  "header",
  "li",
  "ol",
  "p",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

function printedLines(markup: string): string[] {
  const parts: string[] = [];
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>|([^<]+)/g;

  for (const match of markup.matchAll(pattern)) {
    const [, tag, selfClosing, text] = match;
    if (text !== undefined) {
      const collapsed = text.replace(/\s+/g, " ");
      if (collapsed !== "") parts.push(collapsed);
    } else if (tag && BLOCK.has(tag.toLowerCase()) && selfClosing !== "/") {
      parts.push("\n");
    }
  }

  return parts
    .join("")
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, decodePrintedEntity)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function decodePrintedEntity(entity: string): string {
  switch (entity) {
    case "&#x27;":
      return "'";
    case "&quot;":
      return '"';
    case "&amp;":
      return "&";
    case "&lt;":
      return "<";
    case "&gt;":
      return ">";
    default:
      return entity;
  }
}

function golden(id: string): string[] {
  return readFileSync(`${GOLDEN}/${id}.txt`, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function sheetLines(id: string): string[] {
  const sheet = SHEET_BY_ID.get(id);
  if (!sheet) throw new Error(`no sheet «${id}»`);
  return printedLines(
    renderToStaticMarkup(
      <SheetDocument
        sheet={sheet}
        decision={CASE}
        lookups={lookups}
        register={register}
        letterhead={letterhead}
        translate={translate}
        locale="fa"
      />,
    ),
  );
}

describe("what the worksheets put on paper", () => {
  it("has a golden for every form the office can issue", () => {
    /*
     * Guards the guard. A form added to the catalogue with no golden beside it
     * is a form nothing below checks, and the suite would still be green.
     */
    for (const sheet of SHEETS) {
      expect(() => golden(sheet.id), `${sheet.id} has a golden`).not.toThrow();
    }
  });

  for (const sheet of SHEETS) {
    it(`prints ${sheet.id} as the university has it on file`, () => {
      expect(sheetLines(sheet.id)).toEqual(golden(sheet.id));
    });
  }
});
