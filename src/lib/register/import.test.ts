import { describe, expect, it } from "vitest";
import type { AnyFieldSpec as FieldSpec } from "@/lib/register/field-spec.ts";
import {
  asFormValue,
  IMPORT_LIMIT,
  type ImportVocabulary,
  parseCsv,
  planImport,
} from "./import.ts";

/**
 * Reading a spreadsheet back into a register.
 *
 * ── Why the parser gets as much attention as the plan ───────────────────────
 *
 * Because its failures are silent and structural. A parser that splits on
 * commas reads a thesis title containing one comma as two columns and shifts
 * every value after it one field to the left — so a degree lands in the status
 * column, a status in the department, and the whole row imports without a single
 * complaint. Nobody finds that by looking at the import screen; they find it
 * months later, on one student's record.
 *
 * ── What the plan is for ────────────────────────────────────────────────────
 *
 * An office holding a file somebody else prepared needs «what will this do»
 * answered before anything is written. Every case below is a way a real file is
 * wrong: a heading that does not match, a degree spelled a way this institution
 * does not offer, a missing student number, the same student twice.
 */

describe("parseCsv", () => {
  it("reads the plain case", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a separator that is inside a quoted cell", () => {
    /* The failure this exists for: one comma in a thesis title, and every
       column after it lands in the wrong field — silently. */
    expect(parseCsv('"عنوان, با ویرگول",دکتری')).toEqual([["عنوان, با ویرگول", "دکتری"]]);
  });

  it("keeps a line break that is inside a quoted cell", () => {
    /* The council's attendance lists are one name per line and export as one
       cell; read naively they become two records, one of them nonsense. */
    expect(parseCsv('"سعید\nفاطمه",۲')).toEqual([["سعید\nفاطمه", "۲"]]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('"پایان‌نامه‌ی ""الف"""')).toEqual([['پایان‌نامه‌ی "الف"']]);
  });

  it("drops the byte-order mark its own export writes", () => {
    /*
     * Every file this application exports begins with one — without it Excel
     * reads UTF-8 as the system code page and every Persian name arrives as
     * mojibake. A parser that kept it would fail to match the very first column
     * of its own output.
     */
    expect(parseCsv('﻿"نام"\n"مریم"')).toEqual([["نام"], ["مریم"]]);
  });

  it("reads CRLF the way a spreadsheet writes it", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads a last row with no newline after it", () => {
    expect(parseCsv("a\n1")).toEqual([["a"], ["1"]]);
  });

  it("ignores a blank line rather than reading it as an empty record", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps an empty cell as an empty cell", () => {
    /* Not a shorter row: the columns after it would shift. */
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

const FIELDS: FieldSpec[] = [
  { key: "studentNumber", kind: "text", group: "identity", format: "digits" },
  { key: "firstName", kind: "text", group: "identity" },
  { key: "lastName", kind: "text", group: "identity" },
  { key: "degree", kind: "lookup", group: "academic", set: "degrees" },
];

const LABELS: Record<string, string> = {
  studentNumber: "شماره دانشجویی",
  firstName: "نام",
  lastName: "نام خانوادگی",
  degree: "مقطع",
};

const vocabularies: ImportVocabulary = {
  get: (set) =>
    set === "degrees"
      ? [
          { value: "phd", label: "دکتری تخصصی" },
          { value: "master", label: "کارشناسی ارشد" },
        ]
      : undefined,
};

const words = {
  unknownValue: "این مقدار در فهرست مرجع نیست",
  missingKey: "شماره دانشجویی خالی است",
  duplicateKey: "این شماره در همین فایل تکرار شده",
  malformedCsv: "ساختار فایل CSV معتبر نیست",
  tooManyRows: "تعداد ردیف‌های فایل بیش از حد مجاز است",
};

const plan = (text: string, existing: [string, string][] = []) =>
  planImport({
    text,
    fields: FIELDS,
    labels: LABELS,
    vocabularies,
    keyField: "studentNumber",
    existing: new Map(existing),
    words,
    limit: IMPORT_LIMIT,
  });

describe("what a file would do", () => {
  it("files a row whose key is not on record as a new one", () => {
    const result = plan("شماره دانشجویی,نام\n۴۰۰۱,مریم");
    expect(result.creates).toHaveLength(1);
    expect(result.updates).toHaveLength(0);
    expect(result.creates[0]?.values).toEqual({ studentNumber: "۴۰۰۱", firstName: "مریم" });
  });

  it("files a row whose key is on record as a correction, carrying the id", () => {
    const result = plan("شماره دانشجویی,نام\n۴۰۰۱,مریم", [["۴۰۰۱", "abc"]]);
    expect(result.creates).toHaveLength(0);
    expect(result.updates[0]?.id).toBe("abc");
  });

  it("numbers a line the way a spreadsheet does", () => {
    /* The header is line 1, so the first record is line 2 — which is what the
       reader sees when they open the file to fix it. */
    expect(plan("شماره دانشجویی\n۴۰۰۱\n۴۰۰۲").creates.map((one) => one.line)).toEqual([2, 3]);
  });

  it("matches a heading by the word the export wrote", () => {
    expect(plan("نام خانوادگی,شماره دانشجویی\nرضایی,۴۰۰۱").creates[0]?.values).toEqual({
      lastName: "رضایی",
      studentNumber: "۴۰۰۱",
    });
  });

  it("matches a heading by the field's own key too", () => {
    /* A file assembled by hand from the schema, rather than from an export. */
    expect(plan("studentNumber,firstName\n۴۰۰۱,مریم").creates[0]?.values.firstName).toBe("مریم");
  });

  it("names a heading it has no field for rather than dropping it in silence", () => {
    /*
     * A column the register cannot store is the commonest reason an import
     * «works» and loses data: the file had it, the register does not, and
     * nothing said so.
     */
    const result = plan("شماره دانشجویی,معدل کل\n۴۰۰۱,۱۸");
    expect(result.ignored).toEqual(["معدل کل"]);
    expect(result.creates[0]?.values).toEqual({ studentNumber: "۴۰۰۱" });
  });

  it("resolves a vocabulary cell from the word in it", () => {
    /* Nobody types `professional_doctorate` into a spreadsheet. */
    expect(plan("شماره دانشجویی,مقطع\n۴۰۰۱,دکتری تخصصی").creates[0]?.values.degree).toBe("phd");
  });

  it("accepts the stored key in a vocabulary cell as well", () => {
    expect(plan("شماره دانشجویی,مقطع\n۴۰۰۱,master").creates[0]?.values.degree).toBe("master");
  });

  it("refuses a vocabulary word this institution does not offer", () => {
    /*
     * Stored as typed, an unrecognised degree renders as its own raw text on
     * every screen afterwards — and is invisible to every filter and report.
     */
    const result = plan("شماره دانشجویی,مقطع\n۴۰۰۱,کاردانی");
    expect(result.creates).toHaveLength(0);
    expect(result.faults[0]).toMatchObject({ line: 2, column: "مقطع", value: "کاردانی" });
  });

  it("refuses a row with no key, and says which column", () => {
    /* A file whose key column was mistyped in the heading produces one of these
       per line, which is how the reader learns the heading is wrong. */
    const result = plan("شماره دانشجویی,نام\n,مریم");
    expect(result.faults[0]).toMatchObject({ line: 2, column: "شماره دانشجویی" });
  });

  it("refuses the same key twice in one file, pointing at the second", () => {
    /*
     * The file disagreeing with itself. Applied, the last line would win
     * silently — so both are refused and the reader is sent to the second.
     */
    const result = plan("شماره دانشجویی,نام\n۴۰۰۱,مریم\n۴۰۰۱,زهرا");
    expect(result.creates).toHaveLength(1);
    expect(result.faults).toHaveLength(1);
    expect(result.faults[0]).toMatchObject({ line: 3, reason: words.duplicateKey });
  });

  it("reads the whole file rather than stopping at the first fault", () => {
    /*
     * «Line 41 is wrong» after forty were written leaves an office working out
     * which forty. Every row is examined; a fault stops that row and nothing
     * else.
     */
    const result = plan(
      "شماره دانشجویی,مقطع\n۴۰۰۱,کاردانی\n۴۰۰۲,دکتری تخصصی\n,x\n۴۰۰۴,دکتری تخصصی",
    );
    expect(result.creates.map((one) => one.line)).toEqual([3, 5]);
    expect(result.faults.map((one) => one.line)).toEqual([2, 4]);
  });

  it("treats a blank cell as a field the file does not set", () => {
    /* Not as an instruction to clear it: a spreadsheet full of empty optional
       columns would otherwise blank half of every record it touched. */
    expect(plan("شماره دانشجویی,نام\n۴۰۰۱,").creates[0]?.values).toEqual({
      studentNumber: "۴۰۰۱",
    });
  });

  it("trims what a spreadsheet padded", () => {
    expect(plan("شماره دانشجویی , نام \n ۴۰۰۱ , مریم ").creates[0]?.values).toEqual({
      studentNumber: "۴۰۰۱",
      firstName: "مریم",
    });
  });

  it("reads nothing out of a file with only a header", () => {
    const result = plan("شماره دانشجویی,نام");
    expect(result.creates).toHaveLength(0);
    expect(result.faults).toHaveLength(0);
  });

  it("stops at the cap", () => {
    const lines = ["شماره دانشجویی", ...Array.from({ length: 12 }, (_, at) => String(at + 1))];
    const result = planImport({
      text: lines.join("\n"),
      fields: FIELDS,
      labels: LABELS,
      vocabularies,
      keyField: "studentNumber",
      existing: new Map(),
      words,
      limit: 10,
    });
    expect(result.creates).toHaveLength(10);
    expect(result.totalRows).toBe(12);
    expect(result.truncated).toBe(true);
  });

  it("does not mark a file exactly at the cap as truncated", () => {
    const lines = ["شماره دانشجویی", ...Array.from({ length: 10 }, (_, at) => String(at + 1))];
    const result = planImport({
      text: lines.join("\n"),
      fields: FIELDS,
      labels: LABELS,
      vocabularies,
      keyField: "studentNumber",
      existing: new Map(),
      words,
      limit: 10,
    });
    expect(result.creates).toHaveLength(10);
    expect(result.totalRows).toBe(10);
    expect(result.truncated).toBe(false);
  });
});

describe("composite import identity", () => {
  const decisionFields: FieldSpec[] = [
    { key: "meetingNumber", kind: "text", group: "meeting", format: "sittingNumber" },
    { key: "reportCategory", kind: "lookup", group: "meeting", set: "decision_report_categories" },
    { key: "thesisCode", kind: "text", group: "identity", format: "code" },
    { key: "studentName", kind: "text", group: "identity" },
  ];
  const decisionLabels = {
    meetingNumber: "شماره جلسه",
    reportCategory: "نوع مصوبه",
    thesisCode: "کد پایان‌نامه",
    studentName: "نام دانشجو",
  };
  const decisionVocabulary: ImportVocabulary = {
    get: (set) =>
      set === "decision_report_categories"
        ? [
            { value: "thesis_proposal", label: "پیشنهاده پایان‌نامه" },
            { value: "thesis_final_defense", label: "دفاع نهایی پایان‌نامه" },
          ]
        : undefined,
  };

  it("updates only the same sitting, canonical stage and dossier code", () => {
    const existing = new Map([
      [JSON.stringify(["680", "thesis_proposal", "TH-42"]), "proposal-id"],
      [JSON.stringify(["680", "thesis_final_defense", "TH-42"]), "defence-id"],
    ]);
    const result = planImport({
      text: "شماره جلسه,نوع مصوبه,کد پایان‌نامه,نام دانشجو\n۶۸۰,پیشنهاده پایان‌نامه,TH-42,مریم",
      fields: decisionFields,
      labels: decisionLabels,
      vocabularies: decisionVocabulary,
      keyField: "thesisCode",
      identityFields: ["meetingNumber", "reportCategory", "thesisCode"],
      existing,
      words,
      limit: IMPORT_LIMIT,
    });

    expect(result.creates).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.id).toBe("proposal-id");
  });

  it("treats another stage of the same dossier as a distinct record", () => {
    const existing = new Map([
      [JSON.stringify(["680", "thesis_proposal", "TH-42"]), "proposal-id"],
    ]);
    const result = planImport({
      text: "شماره جلسه,نوع مصوبه,کد پایان‌نامه\n۶۸۰,دفاع نهایی پایان‌نامه,TH-42",
      fields: decisionFields,
      labels: decisionLabels,
      vocabularies: decisionVocabulary,
      keyField: "thesisCode",
      identityFields: ["meetingNumber", "reportCategory", "thesisCode"],
      existing,
      words,
      limit: IMPORT_LIMIT,
    });

    expect(result.updates).toHaveLength(0);
    expect(result.creates).toHaveLength(1);
  });

  it("normalizes Persian sitting digits before preview decides create versus update", () => {
    const existing = new Map([
      [JSON.stringify(["680", "thesis_proposal", "TH-42"]), "proposal-id"],
    ]);
    const result = planImport({
      text: "شماره جلسه,نوع مصوبه,کد پایان‌نامه\n۶۸۰,thesis_proposal,TH-42",
      fields: decisionFields,
      labels: decisionLabels,
      vocabularies: decisionVocabulary,
      keyField: "thesisCode",
      identityFields: ["meetingNumber", "reportCategory", "thesisCode"],
      existing,
      words,
      limit: IMPORT_LIMIT,
    });

    expect(result.updates[0]?.id).toBe("proposal-id");
  });
});

describe("asFormValue", () => {
  it("reads nothing recorded as an empty box", () => {
    expect(asFormValue(null, "text")).toBe("");
    expect(asFormValue(undefined, "text")).toBe("");
  });

  it("posts a ticked box the way a checkbox does, and an unticked one not at all", () => {
    /*
     * The trap this exists for. The validator's rule is `z.coerce.boolean()`,
     * written for a checkbox: ticked posts «on», unticked posts nothing. Given
     * the string «false» it coerces a non-empty string to `true` — so padding a
     * correction with `String(false)` would tick every unticked box on the
     * record it was correcting.
     */
    expect(asFormValue(true, "boolean")).toBe("on");
    expect(asFormValue(false, "boolean")).toBe("");
  });

  it("leaves a date and a number as the text they already are", () => {
    expect(asFormValue("1404-01-01", "date")).toBe("1404-01-01");
    expect(asFormValue(18.5, "number")).toBe("18.5");
    /* Zero is a value, not an absence. */
    expect(asFormValue(0, "number")).toBe("0");
  });
});
