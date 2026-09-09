import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { type DaySquare, EVENT_TONE, MonthGrid } from "@/components/calendar/month-grid";
import { PageBody } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { parseIntegerParam } from "@/lib/input-limits.ts";
import { cn } from "@/lib/utils";
import { requireModule } from "@/lib/viewer.ts";
import { deleteCalendarEntry, saveCalendarEntry } from "@/modules/calendar/actions.ts";
import { leadingBlanks, monthGrid, monthWindow, todayIso } from "@/modules/calendar/month.ts";
import { type EventKind, readMonth } from "@/modules/calendar/queries.ts";

/**
 * The office's month: what the council is sitting on, what is being defended,
 * which workshops are running, and the notes somebody left.
 *
 * The month is in the address, so «مهر ۱۴۰۵» is a link a colleague can be sent.
 * Everything on it is rendered on the server; the only client code is the grid,
 * which needs to know which day an editor was opened on.
 */

export async function generateMetadata() {
  const t = await getTranslations("calendar");
  return { title: t("title") };
}

interface Params {
  year?: string | string[];
  month?: string | string[];
}

/** شنبه … جمعه, from the vocabulary the sittings register already uses. */
const WEEKDAY_ORDER = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { viewer } = await requireModule("/calendar");
  const params = await searchParams;

  /* Both are checked inside `monthWindow` before they reach a query — see the
     bounds there. An unparseable value falls back to the current month rather
     than erroring, which is what a bookmark from last year deserves. */
  const window = monthWindow(
    parseIntegerParam(params.year) ?? undefined,
    parseIntegerParam(params.month) ?? undefined,
    viewer.tenantTimezone,
  );

  const [t, common, _nav, locale] = await Promise.all([
    getTranslations("calendar"),
    getTranslations("common"),
    getTranslations("nav"),
    getLocale(),
  ]);

  const month = await readMonth(viewer, window, {
    sitting: (number) => t("sittingTitle", { number: toLocaleDigits(number, locale) }),
    defence: (student) => t("defenceTitle", { student }),
    workshop: t("workshopTitle"),
    untitled: t("untitled"),
  });

  const canManage = can(viewer, "calendar.manage");
  const today = todayIso(viewer.tenantTimezone);

  const days: DaySquare[] = monthGrid(window).map((day) => ({
    iso: day.iso,
    label: toLocaleDigits(String(day.day), locale),
    today: day.iso === today,
    /* Friday. The office is closed and the square is tinted, which is what
       makes a month scannable at a glance rather than a wall of squares. */
    weekend: new Date(`${day.iso}T00:00:00`).getDay() === 5,
  }));

  const weekdayNames = WEEKDAY_ORDER.map((key) => t(`weekday.${key}`));

  /*
   * Serialised for the client grid, which cannot be handed a Map — and the
   * clock times localised on the way.
   *
   * `toLocaleDigits` only maps ASCII to Persian, so this is right whichever way
   * the column happens to hold it: a time this application wrote is `09:30` and
   * becomes «۰۹:۳۰», and one an older import left as «۱۴:۳۰» passes through
   * untouched. Without it the two sit in the same square in different numerals.
   */
  const byDay: Record<string, (typeof month.events)[number][]> = {};
  for (const [day, list] of month.byDay) {
    byDay[day] = list.map((event) => ({
      ...event,
      time: event.time === null ? null : toLocaleDigits(event.time, locale),
    }));
  }

  const monthHref = (target: { year: number; month: number }) =>
    `/calendar?year=${target.year}&month=${target.month}`;

  const words: Record<string, string> = {
    addEntry: t("addEntry"),
    editEntry: t("editEntry"),
    deleteEntry: t("deleteEntry"),
    deleteConfirm: t("deleteConfirm"),
    entryTitle: t("entryTitle"),
    startTime: t("startTime"),
    endTime: t("endTime"),
    timePlaceholder: t("timePlaceholder"),
    allDayHint: t("allDayHint"),
    notes: t("notes"),
    onDate: t("onDate"),
    save: common("save"),
    cancel: common("cancel"),
    required: t("required"),
    tooLong: t("tooLong"),
    badDate: t("badDate"),
    badTime: t("badTime"),
    endBeforeStart: t("endBeforeStart"),
    conflict: t("conflict"),
    saveFailed: t("saveFailed"),
  };

  return (
    <PageBody className="flex-1 min-h-[calc(100vh-8.5rem)]">
      <h1 className="sr-only">{t("title")}</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {/*
           * The arrows are links, not buttons.
           *
           * The month is a location: it belongs in the address so it survives a
           * reload, a bookmark and a colleague being sent one — and so the back
           * button steps through the months somebody actually looked at.
           */}
          <Button
            variant="outline"
            size="icon-sm"
            nativeButton={false}
            render={
              <Link href={monthHref(window.previous)} aria-label={t("previousMonth")}>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            }
          />
          <span className="numeric min-w-40 text-center text-base font-semibold">
            {toLocaleDigits(window.label, locale)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            nativeButton={false}
            render={
              <Link href={monthHref(window.next)} aria-label={t("nextMonth")}>
                <ChevronLeft className="size-4" aria-hidden />
              </Link>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/calendar">{t("today")}</Link>}
          />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href="/calendar/export.ics">
                <Calendar className="size-4" aria-hidden />
                {t("exportIcs")}
              </Link>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/calendar/subscriptions">{t("subscriptions.manage")}</Link>}
          />
        </div>

        {/* Only the layers this viewer was actually shown. A legend naming a
            register they cannot read would describe a colour never drawn. */}
        <ul className="flex flex-wrap items-center gap-3">
          {month.shown.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2.5 rounded-sm", EVENT_TONE[kind as EventKind])} />
              {t(`layer.${kind}`)}
            </li>
          ))}
        </ul>
      </div>

      <MonthGrid
        days={days}
        blanks={leadingBlanks(window)}
        events={byDay}
        entries={month.entries}
        weekdays={weekdayNames}
        canManage={canManage}
        save={saveCalendarEntry}
        remove={deleteCalendarEntry}
        t={words}
      />
    </PageBody>
  );
}
