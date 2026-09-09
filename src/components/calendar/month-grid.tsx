"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { cn } from "@/lib/utils";
import type { CalendarEntryDraft, CalendarEvent, EventKind } from "@/modules/calendar/queries.ts";
import { CalendarEntryDialog } from "./entry-dialog";

/**
 * A Jalali month, as a grid of days with what falls on each.
 *
 * A client component for one reason: choosing a day opens the entry editor, and
 * "which day is selected" is browser state that no address needs to carry. The
 * month itself *is* in the address — the arrows are links — so a colleague can
 * be sent «مهر ۱۴۰۵» rather than told to click twice.
 */

export interface DaySquare {
  iso: string;
  /** The day of the Jalali month, already in the reader's numerals. */
  label: string;
  today: boolean;
  /** Friday, which an Iranian week ends on and an office is closed for. */
  weekend: boolean;
}

/** The colour each layer is read in, and what it is called in the legend. */
const TONE: Record<EventKind, string> = {
  sitting: "bg-sky-500/15 text-sky-900 dark:bg-sky-400/20 dark:text-sky-100",
  defence: "bg-violet-500/15 text-violet-900 dark:bg-violet-400/20 dark:text-violet-100",
  workshop: "bg-warning-subtle text-warning-subtle-foreground",
  entry: "bg-success-subtle text-success-subtle-foreground",
};

export function MonthGrid({
  days,
  blanks,
  events,
  entries,
  weekdays,
  canManage,
  save,
  remove,
  t,
}: {
  days: DaySquare[];
  blanks: number;
  /** Every event of the month, keyed by its ISO day. */
  events: Record<string, CalendarEvent[]>;
  /** The office's own entries, whole, by id — see `CalendarEntryDraft`. */
  entries: Record<string, CalendarEntryDraft>;
  /** شنبه … جمعه, in order. */
  weekdays: string[];
  canManage: boolean;
  save: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  remove: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  t: Record<string, string>;
}) {
  const [editing, setEditing] = useState<CalendarEntryDraft | null>(null);

  const open = (day: string, event?: CalendarEvent) => {
    if (!canManage) return;

    /*
     * An existing note is reopened from the stored record, not from the chip.
     *
     * The chip carries a title and a start time, which is what a square draws.
     * Seeding the editor from it would blank the description and the end time
     * on every edit, and — worse — send `version: 0`, which the optimistic
     * guard would refuse on any note that had ever been saved.
     */
    const held = event?.entryId ? entries[event.entryId] : undefined;
    setEditing(
      held ?? {
        id: "",
        version: 0,
        title: "",
        entryDate: day,
        startTime: "",
        endTime: "",
        notes: "",
      },
    );
  };

  const totalCells = Math.ceil((blanks + days.length) / 7) * 7;
  const trailingBlanks = totalCells - (blanks + days.length);

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs min-h-[calc(100vh-11rem)] flex-1">
        <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40">
          {weekdays.map((name) => (
            <div key={name} className="py-2.5 text-center text-xs font-semibold text-foreground/80">
              {name}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
          {/*
           * The squares before the first of the month.
           */}
          {Array.from({ length: blanks }, (_, index) => `leading-blank-${index}`).map((key) => (
            <div
              key={key}
              className="min-h-24 sm:min-h-28 lg:min-h-32 border-b border-s border-border/40 bg-muted/15"
            />
          ))}

          {days.map((day) => {
            const onThisDay = events[day.iso] ?? [];
            return (
              <div
                key={day.iso}
                className={cn(
                  "group relative min-h-24 sm:min-h-28 lg:min-h-32 border-b border-s border-border/40 p-2 sm:p-2.5 transition-colors hover:bg-muted/20 flex flex-col",
                  day.weekend && "bg-muted/30",
                  day.today && "bg-primary/5 ring-1.5 ring-inset ring-primary/50",
                )}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className={cn(
                      "numeric text-xs font-medium",
                      day.today
                        ? "font-bold text-primary inline-flex items-center justify-center size-5 rounded-full bg-primary/15"
                        : "text-muted-foreground",
                    )}
                  >
                    {day.label}
                  </span>
                  {/*
                   * The add button appears on hover and on keyboard focus.
                   */}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t.addEntry} — ${day.label}`}
                      className="size-5 rounded-md opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => open(day.iso)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  {onThisDay.map((event) => {
                    const body = (
                      <>
                        {event.time && (
                          <span className="numeric me-1 opacity-80 font-bold">{event.time}</span>
                        )}
                        <span>{event.title}</span>
                      </>
                    );

                    /* A projected event opens the record it came from; an office
                       entry opens its own editor, because there is nowhere else
                       for it to go. */
                    return event.href ? (
                      <Link
                        key={event.key}
                        href={event.href}
                        title={event.detail ?? event.title}
                        className={cn(
                          "truncate rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium leading-tight transition-all hover:scale-[1.02] shadow-2xs",
                          TONE[event.kind],
                        )}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        key={event.key}
                        title={event.detail ?? event.title}
                        onClick={() => open(day.iso, event)}
                        className={cn(
                          "w-full truncate rounded-md px-1.5 py-0.5 text-start text-[0.7rem] font-medium leading-tight transition-all hover:scale-[1.02] shadow-2xs",
                          TONE[event.kind],
                        )}
                      >
                        {body}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/*
           * The squares after the end of the month to complete the grid.
           */}
          {Array.from({ length: trailingBlanks }, (_, index) => `trailing-blank-${index}`).map(
            (key) => (
              <div
                key={key}
                className="min-h-24 sm:min-h-28 lg:min-h-32 border-b border-s border-border/40 bg-muted/15"
              />
            ),
          )}
        </div>
      </div>

      {editing && (
        <CalendarEntryDialog
          draft={editing}
          onClose={() => setEditing(null)}
          save={save}
          remove={remove}
          t={t}
        />
      )}
    </>
  );
}

export { TONE as EVENT_TONE };
