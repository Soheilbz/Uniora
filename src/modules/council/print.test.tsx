import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChecklistDocument } from "@/components/council/checklist-document";
import { MinutesDocument } from "@/components/council/minutes-document";
import fa from "@/messages/fa.json" with { type: "json" };
import type { SittingMeeting, SittingPapers } from "./papers.ts";
import {
  noteLines,
  orderRulings,
  type SittingAppointment,
  type SittingDecision,
  type SittingRuling,
  sittingTotals,
  splitDecisions,
  writesDissertation,
} from "./sittings.ts";

/**
 * What the sitting's two papers put on A4.
 *
 * ── Why these two documents get a guard nothing else has ────────────────────
 *
 * A minute is an administrative instrument. It goes into a student's file and it
 * is signed, so the office's copies have to agree with each other year on year —
 * a reworded heading, a moved signature block or a different date format makes
 * this build's paperwork inconsistent with everything already filed.
 *
 * Nothing else in this suite would notice. The catalogue stays well-formed, the
 * types are satisfied, the page renders, and one edit to `paper.tsx` changes
 * both documents at once.
 *
 * ── Controlled print contracts ─────────────────────────────────────────────
 *
 * `print-goldens/*.txt` are reviewed reference outputs for the current Web
 * application. They are changed only when the university formally changes the
 * corresponding paper instrument, so a mismatch is treated as a print-contract
 * regression rather than an automatically refreshable snapshot.
 *
 * ── Rendered without a DOM ──────────────────────────────────────────────────
 *
 * `renderToStaticMarkup` returns HTML as a string, which is all this needs:
 * the question is what *text* comes out and in what order, not how a browser
 * lays it out. That keeps the suite's «tests run in Node» rule intact — there is
 * no jsdom here to resolve a font or a computed style, and none is wanted.
 */

const GOLDEN = "src/modules/council/print-goldens";

/* The fixture is the reference's own: sitting 670, two cases and one ruling. */
const seats = {
  primarySupervisor: "عبداله جمشیدی",
  secondarySupervisor: "محمد محسن‌زاده",
  thirdSupervisor: "سعید خانزادی",
  firstAdvisor: "بهروز فتحی",
  secondAdvisor: "امیر افخمی",
  thirdAdvisor: "رضا نراقی",
  reviewer1: "علی مصباح",
  reviewer2: "حسین کاظمی",
  reviewer3: "مهدی رضوی",
  reviewer4Invited: "نیما شریفی",
  graduateStudiesRepresentative: "محسن مالکی",
};

const papers = {
  finalProposalFile: true,
  proposalDefensePermitForm: true,
  researchBackground: true,
  similarityCertificate: true,
  labSafetyCertificate: true,
  bioethicsCertificate: true,
  bioethicsCode: "دارد",
  languageCertificate: true,
  thesisFile: true,
  defensePermitForm: true,
  defenseSimilarityCertificate: true,
  defenseLanguageCertificate: true,
  researchPerformanceReports: true,
};

const base = {
  educationLevel: "master",
  fieldOfStudy: "fs1",
  reviewStatus: "approved",
  councilNotes: "بدون یادداشت",
  proposalDefenseDate: null,
  achievements: "یک مقاله ISI",
  ...seats,
  ...papers,
} satisfies Partial<SittingDecision>;

const decisions: SittingDecision[] = [
  {
    ...base,
    id: "d1",
    studentNumber: "4002612042",
    studentName: "نادیا فیجی وری",
    thesisTitle: "بررسی اثر ضدمیکروبی پست‌بیوتیک‌ها",
    reportCategory: "thesis_proposal",
  },
  {
    ...base,
    id: "d2",
    studentNumber: "4011234567",
    studentName: "سارا احمدی",
    thesisTitle: "ارزیابی باقی‌مانده آنتی‌بیوتیک در شیر خام",
    reportCategory: "thesis_final_defense",
  },
];

const rulings: SittingRuling[] = [
  {
    id: "r1",
    reportCategory: "thesis_changes",
    reviewStatus: "approved",
    decisionText: "درخواست تغییر عنوان مورد موافقت قرار گرفت.",
    decisionDescription: "با نظر مساعد داوران.",
  },
];

const meeting: SittingMeeting = {
  id: "m1",
  meetingNumber: "670",
  meetingDate: "2025-12-21",
  meetingTime: "10:00",
  meetingDay: "monday",
  meetingLocation: "سالن شورا",
  researchDeputy: "سعید پژوهشی",
  participants: ["احمد رئیسی", "سعید پژوهشی", "مجید بخشی", "محمد محسن‌زاده"],
  absentees: ["کاوه فرهنگی", "زهرا آموزشی"],
  substitutions: { "کاوه فرهنگی": "بهروز فتحی" },
  notes: "یادداشت جلسه",
};

const selections: SittingAppointment[] = [
  {
    id: "s1",
    studentNumber: "4002612042",
    studentName: "نادیا فیجی وری",
    educationLevel: "master",
    fieldOfStudy: "fs1",
    supervisors: ["عبداله جمشیدی", "محمد محسن‌زاده"],
  },
];

const VOCABULARY: Record<string, Record<string, string>> = {
  degrees: { master: "کارشناسی ارشد" },
  fields_of_study: { fs1: "بهداشت مواد غذایی" },
  weekdays: { monday: "دوشنبه" },
};

function sittingPapers(): SittingPapers {
  const sections = splitDecisions(decisions);
  const ordered = orderRulings(rulings);
  const notes = noteLines(meeting.notes);
  return {
    meeting,
    sections,
    rulings: ordered,
    selections,
    notes,
    totals: sittingTotals(sections, ordered, notes, selections),
    anything: true,
  };
}

const lookup = (set: string, value: string | null) =>
  value ? (VOCABULARY[set]?.[value] ?? value) : "";

const say = (path: string): string => {
  let node: unknown = fa;
  for (const part of path.split(".")) {
    node = (node as Record<string, unknown>)?.[part];
  }
  if (typeof node !== "string") throw new Error(`no wording for ${path}`);
  return node;
};

/** ICU's simple argument form is all these sentences use. */
const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);

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

/**
 * The printed lines of a rendered document.
 *
 * A tag-level walk over the markup rather than a DOM: text runs are kept, a
 * block boundary starts a new line, whitespace collapses to one space. A
 * whitespace-only run between two inline elements is *kept* as a single space —
 * JSX writes the gap between «(الف)» and its title as its own text node, and
 * dropping those runs the two together into a word that is not on the paper.
 */
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
    .replace(/ /g, " ")
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

function golden(name: string): string[] {
  return readFileSync(`${GOLDEN}/${name}.txt`, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function checklistLines(): string[] {
  return printedLines(
    renderToStaticMarkup(
      <ChecklistDocument
        papers={sittingPapers()}
        words={{
          heading: say("documents.checklist.heading"),
          attribute: say("documents.checklist.attribute"),
          sectionA: say("documents.checklist.sectionA"),
          sectionB: say("documents.checklist.sectionB"),
          sectionC: say("documents.checklist.sectionC"),
          sectionCEmpty: say("documents.checklist.sectionCEmpty"),
          letters: {
            a: say("documents.letter.a"),
            b: say("documents.letter.b"),
            c: say("documents.letter.c"),
          },
          doctor: say("documents.doctor"),
          details: {
            number: say("decisions.field.meetingNumber"),
            date: say("decisions.field.meetingDate"),
            time: say("council.field.meetingTime"),
            day: say("decisions.field.meetingDay"),
            place: say("decisions.field.meetingLocation"),
            weekday: lookup("weekdays", meeting.meetingDay),
          },
          label: (key) => say(`decisions.${key}`),
          lookup,
        }}
      />,
    ),
  );
}

function minutesLines(): string[] {
  return printedLines(
    renderToStaticMarkup(
      <MinutesDocument
        papers={sittingPapers()}
        words={{
          heading: say("documents.minutes.heading"),
          subheading: say("documents.minutes.subheading"),
          sectionA: say("documents.minutes.sectionA"),
          sectionB: say("documents.minutes.sectionB"),
          sectionC: say("documents.minutes.sectionC"),
          sectionD: say("documents.minutes.sectionD"),
          sectionDEmpty: say("documents.minutes.sectionDEmpty"),
          letters: {
            a: say("documents.letter.a"),
            b: say("documents.letter.b"),
            c: say("documents.letter.c"),
            d: say("documents.letter.d"),
          },
          present: say("documents.minutes.present"),
          absent: say("documents.minutes.absent"),
          nobody: say("documents.minutes.nobody"),
          signature: say("documents.minutes.signature"),
          researchDeputy: say("decisions.field.researchDeputy"),
          doctor: say("documents.doctor"),
          details: {
            number: say("decisions.field.meetingNumber"),
            date: say("council.field.dateShort"),
            time: say("council.field.timeShort"),
            day: say("decisions.field.meetingDay"),
            place: say("council.field.placeShort"),
            weekday: lookup("weekdays", meeting.meetingDay),
          },
          columns: [
            say("documents.minutes.row"),
            say("decisions.field.studentName"),
            say("decisions.field.studentNumber"),
            say("decisions.field.educationLevel"),
            say("decisions.field.fieldOfStudy"),
            say("decisions.field.primarySupervisor"),
            say("decisions.field.secondarySupervisor"),
            say("decisions.field.thirdSupervisor"),
          ],
          seat: (key) => say(`decisions.${key}`),
          readable: (set, value) => (set ? lookup(set, value) : (value ?? "").trim()) || "…",
          proposalSentence: (values) => fill(say("documents.minutes.itemProposal"), { ...values }),
          defenceSentence: (values) => fill(say("documents.minutes.itemDefence"), { ...values }),
          defenceWithInvited: (values) =>
            fill(say("documents.minutes.itemDefenceInvited"), { ...values }),
          standingIn: (person, member) =>
            fill(say("documents.minutes.standingIn"), { person, member }),
          thesisNoun: (level) =>
            writesDissertation(level)
              ? say("documents.word.dissertation")
              : say("documents.word.thesis"),
          separator: "، ",
        }}
      />,
    ),
  );
}

describe("what the council's papers put on paper", () => {
  it("prints the checklist the university has on file", () => {
    expect(checklistLines()).toEqual(golden("council-checklist"));
  });

  it("prints the minute the university has on file", () => {
    expect(minutesLines()).toEqual(golden("council-minutes"));
  });
});
