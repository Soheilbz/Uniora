/** Date/time helpers for tenant-local civil dates. */

function partsAt(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** YYYY-MM-DD for an instant in an IANA timezone. */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  const p = partsAt(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function nextIsoDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Invalid ISO date");
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/**
 * UTC instant at local midnight for a civil date in an IANA timezone.
 * The short fixed-point loop handles UTC offsets and daylight-saving changes
 * without assuming that a local day is always exactly 24 hours long.
 */
export function startOfDateInTimeZone(date: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Invalid ISO date");
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
  let guess = desired;
  for (let i = 0; i < 4; i += 1) {
    const p = partsAt(new Date(guess), timeZone);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = desired - represented;
    guess += delta;
    if (delta === 0) break;
  }
  const result = new Date(guess);
  if (dateInTimeZone(result, timeZone) !== date)
    throw new Error("Civil date cannot be represented in timezone");
  return result;
}

/** Last representable millisecond of a tenant-local civil date. */
export function endOfDateInTimeZone(date: string, timeZone: string): Date {
  return new Date(startOfDateInTimeZone(nextIsoDate(date), timeZone).getTime() - 1);
}
