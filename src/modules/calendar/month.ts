import { addMonths, endOfMonth, format, startOfMonth } from "date-fns-jalali";

/**
 * The Jalali month a calendar screen is showing, as the two ISO bounds the date
 * columns compare against.
 *
 * ── Why `date-fns-jalali` and not arithmetic here ───────────────────────────
 *
 * A calendar is exactly where a private date conversion gets written, and
 * exactly where it goes unnoticed: it agrees with the rest of the application
 * for eleven months a year and disagrees across Esfand 30, which is a leap day
 * that exists in some years and not others. The library already ships in this
 * project; the alternative is a rule about the 33-year cycle written out by
 * hand in one file.
 *
 * ── Why the bounds are ISO and not Jalali ───────────────────────────────────
 *
 * Every date column in this schema is a PostgreSQL `date`, which is Gregorian.
 * The conversion happens here, once, at the edge — so a query compares dates
 * with dates and nothing downstream has to know which calendar the screen was
 * drawn in.
 */

export interface MonthWindow {
  /** First day of the Jalali month, as a stored ISO date. */
  start: string;
  /** Last day of the same Jalali month, inclusive. */
  end: string;
  year: number;
  /** 1–12. */
  month: number;
  /** How the month names itself — «شهریور ۱۴۰۵». */
  label: string;
  /** The month before and after, for the two arrows. */
  previous: { year: number; month: number };
  next: { year: number; month: number };
}

/** Today in the university's configured IANA time zone. */
function today(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = parts.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** Today's stored ISO date in the university's configured time zone. */
export function todayIso(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * The window for a Jalali year and month, or for the current month.
 *
 * The year and month arrive from the address, so both are checked: a calendar
 * asked for month 47 must not produce a window a query would then run.
 */
export function monthWindow(year?: number, month?: number, timeZone = "UTC"): MonthWindow {
  const now = today(timeZone);

  const wanted =
    year !== undefined &&
    month !== undefined &&
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    year >= 1300 &&
    year <= 1500 &&
    month >= 1 &&
    month <= 12
      ? jalaliFirst(year, month, timeZone)
      : startOfMonth(now);

  const first = startOfMonth(wanted);
  const last = endOfMonth(wanted);

  const [shownYear, shownMonth] = format(first, "yyyy-MM").split("-").map(Number) as [
    number,
    number,
  ];

  const before = format(startOfMonth(addMonths(first, -1)), "yyyy-MM")
    .split("-")
    .map(Number) as [number, number];
  const after = format(startOfMonth(addMonths(first, 1)), "yyyy-MM")
    .split("-")
    .map(Number) as [number, number];

  return {
    start: toIso(first),
    end: toIso(last),
    year: shownYear,
    month: shownMonth,
    label: format(first, "MMMM yyyy"),
    previous: { year: before[0], month: before[1] },
    next: { year: after[0], month: after[1] },
  };
}

/**
 * The Gregorian date on which a given Jalali month begins.
 *
 * `date-fns-jalali` has no constructor from Jalali parts, so this walks from
 * today: the month difference between the wanted month and the current one is
 * exact in months whatever the day lengths are, which is the property that
 * makes the arithmetic safe across a leap Esfand.
 */
function jalaliFirst(year: number, month: number, timeZone = "UTC"): Date {
  const now = startOfMonth(today(timeZone));
  const [nowYear, nowMonth] = format(now, "yyyy-MM").split("-").map(Number) as [number, number];
  const distance = (year - nowYear) * 12 + (month - nowMonth);
  return startOfMonth(addMonths(now, distance));
}

/**
 * A Gregorian date as the ISO string a `date` column holds.
 *
 * Built from the local parts rather than `toISOString()`, which converts to UTC
 * first — and for a date constructed at local midnight in a zone ahead of UTC
 * that lands on the previous day. It is the classic off-by-one that shows up as
 * a calendar whose events are all one square early.
 */
export function toIso(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The days of the month, as a grid that begins on Saturday.
 *
 * ── Why the walk is in UTC ──────────────────────────────────────────────────
 *
 * Stepping a local `Date` a day at a time looks obvious and is wrong across a
 * daylight-saving transition: on the morning the clocks go forward there is no
 * 00:00, so `setDate` lands the cursor on 01:00 and every comparison after it
 * is an hour past the bound — the loop ends one day early and the month loses
 * its last square, silently, with the events on that day simply not drawn.
 *
 * Iran abolished DST in 2022, so this affects only the historical months this
 * calendar can still browse back to — Farvardin 1400 among them, which is
 * exactly where the test caught it. UTC has no transitions at all, which is a
 * better answer than knowing which years had them.
 */
export function monthGrid(window: MonthWindow): { iso: string; day: number }[] {
  const start = Date.parse(`${window.start}T00:00:00Z`);
  const end = Date.parse(`${window.end}T00:00:00Z`);

  const days: { iso: string; day: number }[] = [];
  for (let at = start, day = 1; at <= end; at += 86_400_000, day += 1) {
    const cursor = new Date(at);
    const year = String(cursor.getUTCFullYear()).padStart(4, "0");
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const date = String(cursor.getUTCDate()).padStart(2, "0");
    /* The day of the Jalali month is the ordinal within it — the walk starts on
       the first, so counting is the conversion. */
    days.push({ iso: `${year}-${month}-${date}`, day });
  }
  return days;
}

/**
 * How many blank squares precede the first of the month.
 *
 * A Persian week runs شنبه to جمعه, so the count is the first's distance from
 * Saturday. `getUTCDay()` rather than `getDay()`, for the reason above and for
 * one more: a server west of UTC would read a date parsed at local midnight as
 * the previous day, and the whole month would be drawn one column out.
 */
export function leadingBlanks(window: MonthWindow): number {
  return (new Date(`${window.start}T00:00:00Z`).getUTCDay() + 1) % 7;
}
