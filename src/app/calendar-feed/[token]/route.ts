import type { NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/application-origin.ts";
import { renderIcs } from "@/lib/calendar/ics.ts";
import { dateInTimeZone } from "@/lib/date-time.ts";
import { readCalendarRange } from "@/modules/calendar/queries.ts";
import { viewerForCalendarSubscription } from "@/modules/calendar/subscriptions.ts";

const DAY = 86_400_000;
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const viewer = await viewerForCalendarSubscription((await params).token);
  if (!viewer)
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const start = dateInTimeZone(new Date(Date.now() - 30 * DAY), viewer.tenantTimezone);
  const end = dateInTimeZone(new Date(Date.now() + 365 * DAY), viewer.tenantTimezone);
  const events = await readCalendarRange(
    viewer,
    { start, end },
    {
      sitting: (n) => `Council sitting ${n}`.trim(),
      defence: (s) => `Defence — ${s}`,
      workshop: "Workshop",
      untitled: "Calendar entry",
    },
  );
  return new Response(
    renderIcs({ events, timezone: viewer.tenantTimezone, origin: applicationOrigin() }),
    {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
