import { describe, expect, it } from "vitest";
import { leadingBlanks, monthGrid, monthWindow, toIso } from "./month.ts";

/**
 * The Jalali month window.
 *
 * ── Why this is worth a test and most date code is not ──────────────────────
 *
 * A calendar is where a private date conversion gets written, and where it goes
 * unnoticed: it agrees with the rest of the application for eleven months a
 * year and disagrees across Esfand, whose length depends on a 33-year leap
 * cycle. A month that came out one day short would draw a grid missing its last
 * square, and the events on that day would simply not appear — no error, no gap
 * anybody would look twice at.
 *
 * So the assertions below are about *properties* rather than about dates typed
 * out here: the months this calendar has must be 29, 30 or 31 days, the first
 * six are 31, the next five are 30, and the window's bounds must be the first
 * and last of the same month. A table of expected dates would be a second
 * implementation of the calendar, and a wrong one is as easy to write here as
 * in the module.
 */
describe("the Jalali month window", () => {
  /** Every month of a decade, which spans several leap years either way. */
  const decade = Array.from({ length: 10 * 12 }, (_, index) => ({
    year: 1400 + Math.floor(index / 12),
    month: (index % 12) + 1,
  }));

  it("spans exactly one month, first to last", () => {
    for (const { year, month } of decade) {
      const window = monthWindow(year, month);
      expect(window.year, `${year}/${month}`).toBe(year);
      expect(window.month, `${year}/${month}`).toBe(month);

      const days = monthGrid(window);
      expect(days[0]?.day, `${year}/${month} first`).toBe(1);
      expect(days[0]?.iso, `${year}/${month} start`).toBe(window.start);
      expect(days.at(-1)?.iso, `${year}/${month} end`).toBe(window.end);

      /* The last square is the last day of the month, so the day after the
         window's end must belong to the next month. That is the property a
         short month would break, and it does not depend on knowing the
         lengths. */
      expect(days.at(-1)?.day, `${year}/${month} length`).toBe(days.length);
    }
  });

  it("gives the first six months 31 days and the next five 30", () => {
    for (const { year, month } of decade) {
      const length = monthGrid(monthWindow(year, month)).length;
      if (month <= 6) expect(length, `${year}/${month}`).toBe(31);
      else if (month <= 11) expect(length, `${year}/${month}`).toBe(30);
      /* Esfand is 29 or 30 — which of the two is the leap rule, and the point
         of using a library rather than writing that rule out here. */ else
        expect([29, 30], `${year}/${month}`).toContain(length);
    }
  });

  it("finds a leap Esfand and an ordinary one in the same decade", () => {
    /*
     * A guard on the guard above. `toContain([29, 30])` passes just as happily
     * if every Esfand came out 30 — which is what a broken leap rule looks
     * like — so this asserts the decade actually holds both.
     */
    const lengths = new Set(
      Array.from({ length: 10 }, (_, index) => monthGrid(monthWindow(1400 + index, 12)).length),
    );
    expect([...lengths].sort()).toEqual([29, 30]);
  });

  it("steps to the neighbouring months without skipping one", () => {
    for (const { year, month } of decade) {
      const window = monthWindow(year, month);

      const expectedNext = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
      const expectedPrevious =
        month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

      expect(window.next, `${year}/${month}`).toEqual(expectedNext);
      expect(window.previous, `${year}/${month}`).toEqual(expectedPrevious);
    }
  });

  it("puts the first of the month under the right weekday", () => {
    for (const { year, month } of decade) {
      const window = monthWindow(year, month);
      const blanks = leadingBlanks(window);
      expect(blanks, `${year}/${month}`).toBeGreaterThanOrEqual(0);
      expect(blanks, `${year}/${month}`).toBeLessThan(7);

      /*
       * The Persian week runs شنبه to جمعه, so the count of blanks is the
       * first's distance from Saturday. Checked against the day itself rather
       * than restated: `getDay()` is 0 for Sunday, so Saturday is 6, and the
       * blanks must be exactly `(day + 1) % 7`.
       */
      const first = new Date(`${window.start}T00:00:00`);
      expect(blanks, `${year}/${month} weekday`).toBe((first.getDay() + 1) % 7);
    }
  });

  it("falls back to the current month for anything out of range", () => {
    const now = monthWindow();

    /* The year and month arrive from the address, so both are checked before
       they reach a query. A month of 47 must produce this month, not a window
       nothing would match. */
    for (const [year, month] of [
      [1405, 0],
      [1405, 13],
      [1200, 6],
      [9999, 6],
      [Number.NaN, 6],
    ] as const) {
      const window = monthWindow(year, month);
      expect(window.start, `${year}/${month}`).toBe(now.start);
      expect(window.end, `${year}/${month}`).toBe(now.end);
    }
  });

  it("writes an ISO date from the local day, not from UTC", () => {
    /*
     * `toISOString()` converts to UTC first, and for a date built at local
     * midnight in a zone ahead of UTC that lands on the previous day. It is the
     * off-by-one that shows up as a calendar whose events are all one square
     * early.
     */
    const midnight = new Date(2026, 7, 23, 0, 0, 0);
    expect(toIso(midnight)).toBe("2026-08-23");
  });
});
