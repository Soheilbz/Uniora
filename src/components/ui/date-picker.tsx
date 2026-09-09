"use client";

import {
  addMonths,
  endOfMonth,
  format,
  getDate,
  getMonth,
  getYear,
  isSameDay,
  isToday,
  setMonth,
  setYear,
  startOfMonth,
  subMonths,
} from "date-fns-jalali";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useCalendarSystem } from "@/components/calendar-system-provider";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toLocaleDigits } from "@/lib/digits";
import { cn } from "@/lib/utils";

const WEEKDAYS_FA = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;
const WEEKDAYS_EN = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"] as const;

/** Format a calendar day as the storage-safe `YYYY-MM-DD` value in the
 * university's configured IANA time zone. */
function toIsoDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Parses a stored `YYYY-MM-DD` into a local calendar day, at noon.
 *
 * Noon rather than midnight because a midnight date parsed as UTC and then
 * read back through local accessors is a different day in every timezone west
 * of Greenwich; twelve hours past either boundary survives them all.
 */
function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MONTHS_FA = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;
const MONTHS_EN = [
  "Farvardin",
  "Ordibehesht",
  "Khordad",
  "Tir",
  "Mordad",
  "Shahrivar",
  "Mehr",
  "Aban",
  "Azar",
  "Dey",
  "Bahman",
  "Esfand",
] as const;

export interface DatePickerProps {
  name?: string | undefined;
  id?: string | undefined;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((isoDate: string) => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  required?: boolean | undefined;
  ariaLabel?: string | undefined;
  ariaDescribedBy?: string | undefined;
  ariaInvalid?: boolean | undefined;
}

type ViewMode = "days" | "months" | "years";

/**
 * Advanced Persian Jalali DatePicker with Base UI Popover, date-fns-jalali,
 * and rapid Month / Year selector grids.
 */
export function DatePicker({
  name,
  id,
  value,
  defaultValue = "",
  onChange,
  placeholder,
  disabled = false,
  className,
  required,
  ariaLabel,
  ariaDescribedBy,
  ariaInvalid,
}: DatePickerProps) {
  /* Labels come from the catalogue, not from this file: the picker is used on
     both locales' screens, and hardcoded Persian here is what left the English
     interface with Persian buttons. */
  const t = useTranslations("common");
  const calendarSystem = useCalendarSystem();
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  const persianUi = locale.toLowerCase().startsWith("fa");
  const weekdays = persianUi ? WEEKDAYS_FA : WEEKDAYS_EN;
  const months = persianUi ? MONTHS_FA : MONTHS_EN;
  const digits = (value: string | number) => toLocaleDigits(String(value), locale);
  const [selectedIso, setSelectedIso] = useState<string>(value ?? defaultValue);
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("days");

  useEffect(() => {
    if (value !== undefined) {
      setSelectedIso(value);
    }
  }, [value]);

  const selectedDate = useMemo(() => {
    if (!selectedIso) return null;
    return parseIsoDate(selectedIso);
  }, [selectedIso]);

  const [viewDate, setViewDate] = useState<Date>(() => selectedDate ?? new Date());

  useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate);
    }
  }, [selectedDate]);

  // Reset viewMode to "days" when popover reopens
  useEffect(() => {
    if (open) {
      setViewMode("days");
    }
  }, [open]);

  const handleSelect = (d: Date | null) => {
    setSelectedIso(d ? toIsoDate(d, timeZone) : "");
    onChange?.(d ? toIsoDate(d, timeZone) : "");
    setOpen(false);
  };

  const currentYear = getYear(viewDate);
  const currentMonth = getMonth(viewDate);

  // Decade calculation for Year picker grid
  const decadeStart = Math.floor(currentYear / 10) * 10;
  const yearsList = Array.from({ length: 12 }, (_, idx) => decadeStart - 1 + idx);

  // Build calendar matrix for days
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const startDayOffset = (monthStart.getDay() + 1) % 7;
  const totalDays = getDate(monthEnd);

  const days: Date[] = [];
  for (let i = 1; i <= totalDays; i++) {
    const dayDate = new Date(monthStart);
    dayDate.setDate(monthStart.getDate() + (i - 1));
    days.push(dayDate);
  }

  const formattedDisplay = useMemo(() => {
    if (!selectedDate) return null;
    try {
      return toLocaleDigits(format(selectedDate, "yyyy/MM/dd"), locale);
    } catch {
      return selectedIso;
    }
  }, [selectedDate, selectedIso, locale]);

  if (calendarSystem === "gregorian") {
    return (
      <Input
        id={id}
        name={name}
        type="date"
        value={selectedIso}
        onChange={(event) => {
          setSelectedIso(event.target.value);
          onChange?.(event.target.value);
        }}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        aria-required={required || undefined}
        className={cn("w-full sm:w-auto", className)}
      />
    );
  }

  return (
    <div className={cn("relative inline-block w-full sm:w-auto", className)}>
      {name && <input type="hidden" name={name} value={selectedIso} required={required} />}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          aria-required={required || undefined}
          className={cn(
            "flex h-9 w-full min-w-40 items-center justify-between gap-2 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium shadow-2xs transition-colors",
            "hover:border-primary/50 focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30",
            selectedIso && !disabled && "pe-8",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("truncate", !formattedDisplay && "text-muted-foreground/70")}>
              {formattedDisplay ?? placeholder ?? t("pickDate")}
            </span>
          </div>
        </PopoverTrigger>

        {/*
         * The clear button is the trigger's *sibling*, absolutely positioned
         * over its inline end — not its child.
         *
         * Keep the trigger content outside nested interactive elements because `PopoverTrigger` renders a `<button>`:
         * a button inside a button, which browsers are entitled to pull apart,
         * and screen readers read as one control with two stories. As a
         * sibling it is also in the tab order on its own terms, so a keyboard
         * user can clear a selection without opening the calendar at all.
         */}
        {selectedIso && !disabled && (
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground/80 hover:bg-muted hover:text-foreground"
            aria-label={t("clear")}
          >
            <X className="size-3.5" />
          </button>
        )}

        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-76 rounded-xl border border-border/80 bg-card p-3 shadow-xl backdrop-blur-md"
        >
          {/* Header Navigation */}
          <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
            <button
              type="button"
              onClick={() => {
                if (viewMode === "days") setViewDate((curr) => addMonths(curr, 1));
                else if (viewMode === "months")
                  setViewDate((curr) => setYear(curr, currentYear + 1));
                else if (viewMode === "years")
                  setViewDate((curr) => setYear(curr, currentYear + 10));
              }}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={t("next")}
            >
              <ChevronRight className="size-4" />
            </button>

            {/* Clickable Month/Year Title to Switch Mode */}
            <div className="flex items-center gap-1.5 font-bold text-xs">
              {viewMode === "days" && (
                <>
                  <button
                    type="button"
                    onClick={() => setViewMode("months")}
                    className="rounded-md px-2 py-1 text-foreground hover:bg-muted transition-colors"
                  >
                    {months[currentMonth]}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("years")}
                    className="rounded-md px-2 py-1 text-foreground hover:bg-muted transition-colors"
                  >
                    {digits(currentYear)}
                  </button>
                </>
              )}

              {viewMode === "months" && (
                <button
                  type="button"
                  onClick={() => setViewMode("years")}
                  className="rounded-md px-2 py-1 text-primary hover:bg-muted transition-colors"
                >
                  {digits(currentYear)}
                </button>
              )}

              {viewMode === "years" && (
                <span className="text-foreground px-2 py-1">
                  {digits(decadeStart)} - {digits(decadeStart + 9)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (viewMode === "days") setViewDate((curr) => subMonths(curr, 1));
                else if (viewMode === "months")
                  setViewDate((curr) => setYear(curr, currentYear - 1));
                else if (viewMode === "years")
                  setViewDate((curr) => setYear(curr, currentYear - 10));
              }}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={t("previous")}
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>

          {/* VIEW: Days Grid */}
          {viewMode === "days" && (
            <>
              <div className="grid grid-cols-7 pt-2 text-center text-[11px] font-bold text-muted-foreground/90">
                {weekdays.map((w, idx) => (
                  <div key={w} className={cn("py-1", idx === 6 && "text-rose-500/90")}>
                    {w}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 pt-1">
                {Array.from({ length: startDayOffset }, (_, offset) => offset).map((offset) => (
                  <div key={`offset-${startDayOffset}-${offset}`} className="size-8" />
                ))}

                {days.map((day) => {
                  const isSel = selectedDate ? isSameDay(day, selectedDate) : false;
                  const isTod = isToday(day);
                  const isFri = (day.getDay() + 1) % 7 === 6;

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => handleSelect(day)}
                      aria-label={digits(format(day, "yyyy/MM/dd"))}
                      aria-pressed={isSel}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition-all",
                        "hover:bg-primary/20 hover:text-foreground",
                        isFri && !isSel && "text-rose-500 font-semibold",
                        isTod && !isSel && "ring-1 ring-primary/80 font-bold text-primary",
                        isSel &&
                          "bg-primary text-primary-foreground font-bold shadow-2xs hover:bg-primary hover:text-primary-foreground",
                      )}
                    >
                      {digits(getDate(day))}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* VIEW: Months Picker Grid */}
          {viewMode === "months" && (
            <div className="grid grid-cols-3 gap-2 py-3">
              {months.map((mName, idx) => {
                const isCurrent = idx === currentMonth;
                return (
                  <button
                    key={mName}
                    type="button"
                    onClick={() => {
                      setViewDate((curr) => setMonth(curr, idx));
                      setViewMode("days");
                    }}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition-all",
                      isCurrent
                        ? "bg-primary text-primary-foreground shadow-2xs"
                        : "hover:bg-muted text-foreground",
                    )}
                  >
                    {mName}
                  </button>
                );
              })}
            </div>
          )}

          {/* VIEW: Years Picker Grid */}
          {viewMode === "years" && (
            <div className="grid grid-cols-3 gap-2 py-3">
              {yearsList.map((yr) => {
                const isCurrent = yr === currentYear;
                return (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => {
                      setViewDate((curr) => setYear(curr, yr));
                      setViewMode("months");
                    }}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition-all",
                      isCurrent
                        ? "bg-primary text-primary-foreground shadow-2xs"
                        : "hover:bg-muted text-foreground",
                    )}
                  >
                    {digits(yr)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick Actions Footer */}
          <div className="flex items-center justify-between border-t border-border/50 pt-2.5 mt-2">
            <button
              type="button"
              onClick={() => handleSelect(new Date())}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t("today")}
            </button>

            {selectedIso && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                {t("clear")}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
