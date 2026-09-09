import type { SittingMeeting } from "@/modules/council/papers.ts";

/**
 * The furniture both council papers share.
 *
 * ── Laid out for paper, on screen ───────────────────────────────────────────
 *
 * The right-hand pane is a real sheet: A4's text column at the margins the
 * `@page` rule sets, drawn at the size it will print. The alternative — laying
 * the document out to whatever width the pane happens to be — is how a minute
 * comes out of the printer with its line breaks, its page breaks and its
 * signature block all somewhere else, and the only way to see the real document
 * is to print it.
 *
 * `bg-white text-black` unconditionally. A minute printed from a dark theme is a
 * page of toner, and a council instrument does not have a theme.
 */

/**
 * A Jalali calendar date, as the council's papers print one.
 *
 * `1404/09/30` — numeric, slash-separated, ASCII digits. Not «۳۰ آذر ۱۴۰۴» and
 * not «2025-12-21». This is what the university's filed copies carry, and the
 * details block at the head of both papers is compared against them byte for
 * byte by `print.test.ts`.
 *
 * Parsed and formatted in UTC. A `date` column is a calendar day with no time
 * in it; read in the reader's own zone, «2025-12-21» becomes the previous
 * evening anywhere west of Tehran and the sheet is dated a day early.
 */
export function sittingDate(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).formatToParts(parsed);

  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}/${month}/${day}` : "";
}

/** One A4 sheet. `break-after-page` is what makes it a sheet and not a section. */
export function Sheet({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`council-sheet mx-auto w-full max-w-[186mm] break-after-page bg-white p-8 text-black shadow-sm print:max-w-none print:w-full print:p-0 print:m-0 print:shadow-none ${className}`.trim()}
    >
      {children}
    </section>
  );
}

/**
 * Which sitting this sheet belongs to.
 *
 * ── The two papers head themselves differently, and that is not an oversight ─
 *
 * The **minute** writes «تاریخ» and «ساعت»: it records what happened, so the
 * hour the sitting opened is part of the record. The **checklist** writes
 * «تاریخ جلسه» and «روز جلسه»: it is carried *into* the sitting, and the office
 * finds the sitting by the day of the week rather than by the minute it
 * started. Neither paper carries the other's field. This is version 1's own
 * distinction, and the printed goldens hold both shapes.
 *
 * On every sheet of both documents, because a checklist is four or five sheets
 * of ticks and a sheet that does not say which sitting it belongs to is a sheet
 * that cannot be filed once it leaves the stapler.
 */
export interface SittingLabels {
  number: string;
  /** Minute: «تاریخ». Checklist: «تاریخ جلسه». */
  date: string;
  /** Minute only — «ساعت». */
  time: string;
  /** Checklist only — «روز جلسه». */
  day: string;
  /** Minute: «مکان». Checklist: «محل برگزاری». */
  place: string;
  /** The weekday in its own words, resolved from the vocabulary. */
  weekday: string;
}

export function SittingDetails({
  meeting,
  paper,
  labels,
}: {
  meeting: SittingMeeting;
  paper: "minutes" | "checklist";
  labels: SittingLabels;
}) {
  const entries: [string, string][] =
    paper === "minutes"
      ? [
          [labels.number, meeting.meetingNumber],
          [labels.date, sittingDate(meeting.meetingDate)],
          [labels.time, meeting.meetingTime ?? ""],
          [labels.place, meeting.meetingLocation ?? ""],
        ]
      : [
          [labels.number, meeting.meetingNumber],
          [labels.date, sittingDate(meeting.meetingDate)],
          [labels.day, labels.weekday],
          [labels.place, meeting.meetingLocation ?? ""],
        ];

  return (
    <dl className="sheet-grid grid grid-cols-4 gap-x-6 gap-y-1 border-y border-black/20 py-2 text-xs">
      {/*
       * Four columns at every width, and no `sm:` breakpoint.
       *
       * This document is laid out at true A4 — the pane only shows it — and
       * `sm:` answers to the *viewport*, so a narrow window previewed the
       * sheet two-columns while the printer produced four: the same paper,
       * two different shapes, on the one document an office files. The print
       * stylesheet's A4 width is wider than four of these need, always.
       */}
      {entries
        .filter(([, value]) => value !== "")
        .map(([label, value]) => (
          <div key={label} className="flex gap-1">
            <dt className="text-black/60">{label}:</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/**
 * A lettered section.
 *
 * The minute brackets its letters — «(الف) بررسی پیشنهاده‌ها» — and the
 * checklist does not: «الف) چک لیست مدارک». It is a small difference and it is
 * on every sheet of both papers, so it is one the filed copies would show
 * immediately. `bare` is which.
 */
export function SectionTitle({
  letter,
  title,
  bare = false,
}: {
  letter: string;
  title: string;
  bare?: boolean;
}) {
  return (
    <h2 className="break-after-avoid pt-1 text-sm font-bold">
      {bare ? `${letter})` : `(${letter})`} {title}
    </h2>
  );
}
