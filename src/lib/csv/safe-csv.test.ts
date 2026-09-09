import { describe, expect, it } from "vitest";
import { escapeCsvCell, serializeCsv, serializeCsvWithBom } from "./safe-csv.ts";

describe("safe CSV serialization", () => {
  it.each(["=1+1", "+1", "-1", "@cmd", '   =HYPERLINK("x")'])(
    "neutralizes spreadsheet formula input %s",
    (value) => expect(escapeCsvCell(value).startsWith("\"'")).toBe(true),
  );

  it("quotes quotes and preserves ordinary text", () => {
    expect(escapeCsvCell('پایان‌نامه‌ی "الف"')).toBe('"پایان‌نامه‌ی ""الف"""');
    expect(escapeCsvCell("۱۴۰۴-۰۹-۳۰")).toBe('"۱۴۰۴-۰۹-۳۰"');
  });

  it("serializes objects/dates deterministically enough for cells", () => {
    const date = new Date("2026-09-06T00:00:00.000Z");
    expect(serializeCsv([[date, { a: 1 }, null]])).toBe(
      '"2026-09-06T00:00:00.000Z","{""a"":1}",""',
    );
  });

  it("adds a UTF-8 BOM only when requested", () => {
    expect(serializeCsvWithBom([["نام"], ["ساسان"]])).toBe('\uFEFF"نام"\r\n"ساسان"');
  });
});
