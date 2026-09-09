const MAX_INTERVAL_MINUTES = 525_600;

export type ScheduleSpec =
  | { type: "once" }
  | { type: "interval"; everyMinutes: number }
  | { type: "daily"; at: string }
  | { type: "weekly"; at: string; weekdays: number[] };

type CalendarSchedule = Extract<ScheduleSpec, { type: "daily" | "weekly" }>;
type CalendarDate = { year: number; month: number; day: number };
type CalendarDateTime = CalendarDate & { hour: number; minute: number };

export function parseScheduleSpec(raw: string): ScheduleSpec {
  const source = String(raw ?? "").trim();
  if (source === "once") return { type: "once" };
  const compact = /^interval:(\d+)([mhd])$/i.exec(source);
  if (compact) {
    const amount = Number(compact[1]);
    const unit = compact[2]?.toLowerCase();
    const multiplier = unit === "m" ? 1 : unit === "h" ? 60 : 1440;
    return intervalSpec(amount * multiplier);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("invalid schedule format");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid schedule format");
  }
  const record = parsed as Record<string, unknown>;
  if (record.type === "once") return { type: "once" };
  if (record.type === "interval") return intervalSpec(Number(record.everyMinutes));
  if (record.type === "daily") return { type: "daily", at: clock(record.at) };
  if (record.type === "weekly") {
    const weekdays = normalizedWeekdays(record.weekdays);
    if (!weekdays.length) throw new Error("weekly schedule requires a weekday");
    return { type: "weekly", at: clock(record.at), weekdays };
  }
  throw new Error("unsupported schedule type");
}

export function serializeScheduleSpec(spec: ScheduleSpec): string {
  return spec.type === "once" ? "once" : JSON.stringify(spec);
}

export function validateTimeZone(value: string): string {
  const zone = String(value ?? "").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
  } catch {
    throw new Error("invalid timezone");
  }
  return zone;
}

export function calculateNextRunAt(
  spec: ScheduleSpec,
  timeZone: string,
  after = new Date(),
): Date | null {
  if (spec.type === "once") return after;
  if (spec.type === "interval") return new Date(after.getTime() + spec.everyMinutes * 60_000);
  return nextCalendarOccurrence(spec, timeZone, after, after);
}

export function calculateNextScheduledOccurrence(
  spec: ScheduleSpec,
  timeZone: string,
  previousDueAt: Date,
  now = new Date(),
): Date | null {
  if (spec.type === "once") return null;
  assertValidDate(previousDueAt, "previous scheduled occurrence");
  assertValidDate(now, "current time");
  if (spec.type === "interval") {
    const intervalMs = spec.everyMinutes * 60_000;
    const previous = previousDueAt.getTime();
    const current = now.getTime();
    const steps = Math.max(1, Math.floor((current - previous) / intervalMs) + 1);
    return new Date(previous + steps * intervalMs);
  }
  return nextCalendarOccurrence(spec, timeZone, now, previousDueAt);
}

export function buildScheduleSpec(input: {
  type: string;
  intervalMinutes?: number;
  at?: string;
  weekdays?: readonly number[];
}): ScheduleSpec {
  if (input.type === "once") return { type: "once" };
  if (input.type === "interval") return intervalSpec(Number(input.intervalMinutes));
  if (input.type === "daily") return { type: "daily", at: clock(input.at) };
  if (input.type === "weekly") {
    const weekdays = normalizedWeekdays(input.weekdays);
    if (!weekdays.length) throw new Error("weekly schedule requires a weekday");
    return { type: "weekly", at: clock(input.at), weekdays };
  }
  throw new Error("unsupported schedule type");
}

function nextCalendarOccurrence(
  spec: CalendarSchedule,
  timeZone: string,
  searchAfter: Date,
  previousDueAt: Date,
): Date {
  const zone = validateTimeZone(timeZone);
  const [hour = 0, minute = 0] = spec.at.split(":").map(Number);
  const start = localDateParts(searchAfter, zone);
  for (let offset = 0; offset < 15; offset += 1) {
    const date = addCalendarDays(start, offset);
    if (spec.type === "weekly" && !spec.weekdays.includes(isoWeekday(date))) continue;
    const candidate = zonedLocalToUtc({ ...date, hour, minute }, zone);
    if (
      candidate &&
      candidate.getTime() > searchAfter.getTime() &&
      candidate.getTime() > previousDueAt.getTime()
    ) {
      return candidate;
    }
  }
  throw new Error("unable to calculate next scheduled occurrence");
}

function normalizedWeekdays(input: unknown): number[] {
  return Array.isArray(input)
    ? [
        ...new Set(
          input.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
        ),
      ].sort((a, b) => a - b)
    : [];
}

function intervalSpec(everyMinutes: number): Extract<ScheduleSpec, { type: "interval" }> {
  if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > MAX_INTERVAL_MINUTES) {
    throw new Error("scheduled interval must be between 1 minute and 1 year");
  }
  return { type: "interval", everyMinutes };
}

function clock(value: unknown): string {
  const result = String(value ?? "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new Error("calendar time must use HH:MM");
  return result;
}

function assertValidDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new Error(`${label} is invalid`);
}

function localDateParts(date: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
  return { year: values.year ?? 1970, month: values.month ?? 1, day: values.day ?? 1 };
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function isoWeekday(date: CalendarDate): number {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function zonedLocalToUtc(local: CalendarDateTime, timeZone: string): Date | null {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const observed = Date.UTC(
      values.year ?? 1970,
      (values.month ?? 1) - 1,
      values.day ?? 1,
      values.hour ?? 0,
      values.minute ?? 0,
      0,
      0,
    );
    const delta = target - observed;
    if (delta === 0) return new Date(guess);
    guess += delta;
  }
  return null;
}
