import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  calendarEntries,
  councilDecisions,
  councilMeetings,
  user,
  workshops,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Capability, Viewer } from "@/lib/capabilities.ts";
import { can } from "@/lib/capabilities.ts";
import type { MonthWindow } from "./month.ts";

/**
 * One month of the calendar, out of the four tables that hold it.
 *
 * ── Four sources, one of them writable ──────────────────────────────────────
 *
 * Council sittings, defences and workshops are rows in registers that own them,
 * so the calendar projects them and never writes them: a sitting moved on the
 * calendar and not in the minutes would be two answers to when the council met.
 * Only `calendar_entries` exists because somebody put it there, and only it is
 * editable here.
 *
 * ── What somebody who is not entitled sees ─────────────────────────────────
 *
 * Nothing, and no error. A register this viewer may not read is not queried at
 * all — the honest answer to "show me the council's sittings" from somebody
 * without `council.view` is an absent layer, not a failed one, and certainly
 * not a refusal on a screen they are entitled to open.
 *
 * ── Bounded to the month ────────────────────────────────────────────────────
 *
 * Each read is bounded rather than fetched whole. The archive grows every year
 * and a screen that pulled eleven years of sittings to draw thirty-one days
 * would get slower every one of them.
 */

/** Which register a day's entry came out of. Drives its colour and its link. */
export type EventKind = "sitting" | "defence" | "workshop" | "entry";

export interface CalendarEvent {
  /** Unique on the screen: two registers may both hold the same uuid. */
  key: string;
  kind: EventKind;
  /** The stored ISO day, exactly as the column holds it. */
  date: string;
  /** `HH:mm` as the office typed it, or null for something with no clock. */
  time: string | null;
  title: string;
  detail: string | null;
  /** The record this opens; null for an office entry, which opens its editor. */
  href: string | null;
  /** The office entry's id, so the editor can reopen it. */
  entryId?: string;
}

/**
 * One office entry, whole, for the editor to reopen.
 *
 * Carried beside the events rather than re-read when a note is clicked. The
 * `version` is the reason: it is what the next write is matched against, and
 * reading it at save time instead of at load time would defeat the guard
 * entirely — the check would compare the row against itself.
 *
 * The rest is here because a projection is not a record. An event carries a
 * title and a start time, which is all a square needs to draw; an editor opened
 * from one carried nothing else, so reopening a note silently emptied its
 * description and its end time.
 */
export interface CalendarEntryDraft {
  id: string;
  version: number;
  title: string;
  entryDate: string;
  startTime: string;
  endTime: string;
  notes: string;
}

export interface CalendarMonth {
  events: CalendarEvent[];
  byDay: Map<string, CalendarEvent[]>;
  /** The office's own entries, by id, for the editor. */
  entries: Record<string, CalendarEntryDraft>;
  /** Which layers were actually read, so the legend can say so. */
  shown: EventKind[];
}

/** The generated titles, supplied by the page so this module needs no locale. */
export interface EventLabels {
  sitting: (number: string) => string;
  defence: (student: string) => string;
  workshop: string;
  untitled: string;
}

/**
 * Calendar projection for an arbitrary bounded ISO-date range.
 *
 * Used by interoperable exports such as ICS. The same entitlement rules as the
 * interactive month view apply: a layer the viewer cannot read is never queried.
 */
export async function readCalendarRange(
  viewer: Viewer,
  range: { start: string; end: string },
  labels: EventLabels,
): Promise<CalendarEvent[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) {
    throw new Error("invalid calendar range");
  }
  if (range.end < range.start) throw new Error("invalid calendar range");

  const entitled = (...required: Capability[]) => can(viewer, ...required);
  const events: CalendarEvent[] = [];

  await readOnly(viewer.tenantId, async (tx) => {
    const inRange = (column: Parameters<typeof gte>[0]) =>
      and(gte(column, range.start), lte(column, range.end));

    if (entitled("council.view")) {
      const sittings = await tx
        .select({
          id: councilMeetings.id,
          date: councilMeetings.meetingDate,
          time: councilMeetings.meetingTime,
          number: councilMeetings.meetingNumber,
          location: councilMeetings.meetingLocation,
        })
        .from(councilMeetings)
        .where(and(isNull(councilMeetings.deletedAt), inRange(councilMeetings.meetingDate)))
        .orderBy(asc(councilMeetings.meetingDate));
      for (const row of sittings) {
        if (!row.date) continue;
        events.push({
          key: `sitting:${row.id}`,
          kind: "sitting",
          date: row.date,
          time: text(row.time),
          title: labels.sitting(text(row.number) ?? ""),
          detail: text(row.location),
          href: `/council-meetings/${row.id}`,
        });
      }

      const defences = await tx
        .select({
          id: councilDecisions.id,
          date: councilDecisions.defenseMeetingDate,
          time: councilDecisions.defenseMeetingTime,
          student: councilDecisions.studentName,
          location: councilDecisions.defenseMeetingLocation,
        })
        .from(councilDecisions)
        .where(
          and(isNull(councilDecisions.deletedAt), inRange(councilDecisions.defenseMeetingDate)),
        )
        .orderBy(asc(councilDecisions.defenseMeetingDate));
      for (const row of defences) {
        if (!row.date) continue;
        events.push({
          key: `defence:${row.id}`,
          kind: "defence",
          date: row.date,
          time: text(row.time),
          title: labels.defence(text(row.student) ?? labels.untitled),
          detail: text(row.location),
          href: `/council-decisions/${row.id}`,
        });
      }
    }

    if (entitled("workshops.view")) {
      const held = await tx
        .select({
          id: workshops.id,
          date: workshops.workshopDate,
          title: workshops.title,
          venue: workshops.venue,
        })
        .from(workshops)
        .where(and(isNull(workshops.deletedAt), inRange(workshops.workshopDate)))
        .orderBy(asc(workshops.workshopDate));
      for (const row of held) {
        if (!row.date) continue;
        events.push({
          key: `workshop:${row.id}`,
          kind: "workshop",
          date: row.date,
          time: null,
          title: text(row.title) ?? labels.workshop,
          detail: text(row.venue),
          href: `/workshops/${row.id}`,
        });
      }
    }

    const notes = await tx
      .select({
        id: calendarEntries.id,
        date: calendarEntries.entryDate,
        start: calendarEntries.startTime,
        title: calendarEntries.title,
        notes: calendarEntries.notes,
        author: user.name,
      })
      .from(calendarEntries)
      .leftJoin(user, eq(user.id, calendarEntries.authorId))
      .where(and(isNull(calendarEntries.deletedAt), inRange(calendarEntries.entryDate)))
      .orderBy(asc(calendarEntries.entryDate));
    for (const row of notes) {
      events.push({
        key: `entry:${row.id}`,
        kind: "entry",
        date: row.date,
        time: text(row.start),
        title: text(row.title) ?? labels.untitled,
        detail: text(row.notes) ?? text(row.author),
        href: null,
        entryId: row.id,
      });
    }
  });

  return events.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      (left.time ?? "99:99").localeCompare(right.time ?? "99:99") ||
      left.title.localeCompare(right.title) ||
      left.key.localeCompare(right.key),
  );
}

function text(value: unknown): string | null {
  const written = typeof value === "string" ? value.trim() : "";
  return written === "" ? null : written;
}

export async function readMonth(
  viewer: Viewer,
  window: MonthWindow,
  labels: EventLabels,
): Promise<CalendarMonth> {
  const entitled = (...required: Capability[]) => can(viewer, ...required);

  const shown: EventKind[] = [];
  const events: CalendarEvent[] = [];
  const entries: Record<string, CalendarEntryDraft> = {};

  await readOnly(viewer.tenantId, async (tx) => {
    const inMonth = (column: Parameters<typeof gte>[0]) =>
      and(gte(column, window.start), lte(column, window.end));

    if (entitled("council.view")) {
      shown.push("sitting", "defence");

      const sittings = await tx
        .select({
          id: councilMeetings.id,
          date: councilMeetings.meetingDate,
          time: councilMeetings.meetingTime,
          number: councilMeetings.meetingNumber,
          location: councilMeetings.meetingLocation,
        })
        .from(councilMeetings)
        .where(and(isNull(councilMeetings.deletedAt), inMonth(councilMeetings.meetingDate)))
        .orderBy(asc(councilMeetings.meetingDate));

      for (const row of sittings) {
        if (!row.date) continue;
        events.push({
          key: `sitting:${row.id}`,
          kind: "sitting",
          date: row.date,
          time: text(row.time),
          title: labels.sitting(text(row.number) ?? ""),
          detail: text(row.location),
          href: `/council-meetings/${row.id}`,
        });
      }

      const defences = await tx
        .select({
          id: councilDecisions.id,
          date: councilDecisions.defenseMeetingDate,
          time: councilDecisions.defenseMeetingTime,
          student: councilDecisions.studentName,
          location: councilDecisions.defenseMeetingLocation,
        })
        .from(councilDecisions)
        .where(
          and(isNull(councilDecisions.deletedAt), inMonth(councilDecisions.defenseMeetingDate)),
        )
        .orderBy(asc(councilDecisions.defenseMeetingDate));

      for (const row of defences) {
        if (!row.date) continue;
        events.push({
          key: `defence:${row.id}`,
          kind: "defence",
          date: row.date,
          time: text(row.time),
          title: labels.defence(text(row.student) ?? labels.untitled),
          detail: text(row.location),
          href: `/council-decisions/${row.id}`,
        });
      }
    }

    if (entitled("workshops.view")) {
      shown.push("workshop");

      const held = await tx
        .select({
          id: workshops.id,
          date: workshops.workshopDate,
          title: workshops.title,
          venue: workshops.venue,
        })
        .from(workshops)
        .where(and(isNull(workshops.deletedAt), inMonth(workshops.workshopDate)))
        .orderBy(asc(workshops.workshopDate));

      for (const row of held) {
        if (!row.date) continue;
        events.push({
          key: `workshop:${row.id}`,
          kind: "workshop",
          date: row.date,
          time: null,
          title: text(row.title) ?? labels.untitled,
          detail: text(row.venue),
          href: `/workshops/${row.id}`,
        });
      }
    }

    /*
     * The office's own entries are always read.
     *
     * They are gated by `calendar.view`, which is what opened this screen — so
     * a viewer who reached here holds it by construction. Checking again would
     * be a check that can never fail, which is worse than none: it reads as a
     * boundary and enforces nothing.
     */
    shown.push("entry");

    const notes = await tx
      .select({
        id: calendarEntries.id,
        date: calendarEntries.entryDate,
        start: calendarEntries.startTime,
        end: calendarEntries.endTime,
        title: calendarEntries.title,
        notes: calendarEntries.notes,
        version: calendarEntries.version,
        author: user.name,
      })
      .from(calendarEntries)
      .leftJoin(user, eq(user.id, calendarEntries.authorId))
      .where(and(isNull(calendarEntries.deletedAt), inMonth(calendarEntries.entryDate)))
      .orderBy(asc(calendarEntries.entryDate));

    for (const row of notes) {
      events.push({
        key: `entry:${row.id}`,
        kind: "entry",
        date: row.date,
        time: text(row.start),
        title: text(row.title) ?? labels.untitled,
        /* The note, or who left it. A calendar entry with neither says only
           what it is called, which is often the whole of it. */
        detail: text(row.notes) ?? text(row.author),
        href: null,
        entryId: row.id,
      });

      entries[row.id] = {
        id: row.id,
        version: row.version,
        title: row.title,
        entryDate: row.date,
        startTime: row.start ?? "",
        endTime: row.end ?? "",
        notes: row.notes ?? "",
      };
    }
  });

  return { events, byDay: groupByDay(events), entries, shown };
}

/**
 * A day's events, in the order they are read.
 *
 * Timed before all-day, earliest first — and all-day entries sort *after* the
 * timed ones rather than before. «جلسه‌ی شورا، ۱۰:۰۰» is a commitment and
 * «تعطیلی دانشکده» is a fact about the whole day; burying the appointment under
 * the notes is the wrong way round. Ties fall back to the title and then the
 * key, so the order is stable between renders — an unstable sort makes a day's
 * chips reshuffle whenever anything else on the page changes.
 */
export function sortDay(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    if (left.time !== right.time) {
      if (left.time === null) return 1;
      if (right.time === null) return -1;
      return left.time.localeCompare(right.time);
    }
    return left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
  });
}

function groupByDay(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const held = byDay.get(event.date);
    if (held) held.push(event);
    else byDay.set(event.date, [event]);
  }
  for (const [day, list] of byDay) byDay.set(day, sortDay(list));
  return byDay;
}
