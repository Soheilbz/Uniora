import type { CalendarEvent } from "@/modules/calendar/queries.ts";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function dateValue(iso: string): string {
  return iso.replace(/-/g, "");
}

function timeValue(time: string): string | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${match[1]}${match[2]}${String(second).padStart(2, "0")}`;
}

/** RFC 5545-compatible calendar export with stable record-derived UIDs. */
export function renderIcs(input: {
  events: readonly CalendarEvent[];
  timezone: string;
  origin: string;
  calendarName?: string;
  generatedAt?: Date;
}): string {
  const generatedAt = input.generatedAt ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Univ Web//Research Administration Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.calendarName ?? "University Research Calendar")}`,
    `X-WR-TIMEZONE:${escapeText(input.timezone)}`,
  ];

  for (const event of input.events) {
    const clock = event.time ? timeValue(event.time) : null;
    const uid = `${event.key.replace(/[^A-Za-z0-9._-]/g, "-")}@univ-web`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${utcStamp(generatedAt)}`);
    if (clock) lines.push(`DTSTART;TZID=${input.timezone}:${dateValue(event.date)}T${clock}`);
    else lines.push(`DTSTART;VALUE=DATE:${dateValue(event.date)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.detail) lines.push(`DESCRIPTION:${escapeText(event.detail)}`);
    if (event.href) lines.push(`URL:${input.origin}${event.href}`);
    lines.push(`CATEGORIES:${event.kind.toUpperCase()}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
