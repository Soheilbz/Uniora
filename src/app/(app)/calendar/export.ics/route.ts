import type { NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/application-origin.ts";
import { renderIcs } from "@/lib/calendar/ics.ts";
import { dateInTimeZone } from "@/lib/date-time.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readCalendarRange } from "@/modules/calendar/queries.ts";

const DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";

function boundedRange(request: NextRequest, timezone: string) {
  const today = dateInTimeZone(new Date(), timezone);
  const defaultEnd = dateInTimeZone(new Date(Date.now() + 365 * DAY), timezone);
  const from = request.nextUrl.searchParams.get("from") ?? today;
  const to = request.nextUrl.searchParams.get("to") ?? defaultEnd;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from)
    return { start: today, end: defaultEnd };
  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs > 366 * DAY) {
    return { start: today, end: defaultEnd };
  }
  return { start: from, end: to };
}

export async function GET(request: NextRequest) {
  const viewer = await requireCapability("calendar.view");
  const range = boundedRange(request, viewer.tenantTimezone);
  const events = await readCalendarRange(viewer, range, {
    sitting: (number) => `Council sitting ${number}`.trim(),
    defence: (student) => `Defence — ${student}`,
    workshop: "Workshop",
    untitled: "Calendar entry",
  });
  const body = renderIcs({
    events,
    timezone: viewer.tenantTimezone,
    origin: applicationOrigin(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="university-calendar.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
