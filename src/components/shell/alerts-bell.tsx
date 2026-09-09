"use client";

import {
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Gauge,
  type LucideIcon,
  Presentation,
  StickyNote,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { STATUS_TONES } from "@/components/engine/tones.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toLocaleDigits } from "@/lib/digits.ts";
import { cn } from "@/lib/utils";
import type { AttentionSignal, AttentionTone } from "@/modules/attention/vocabulary.ts";

/**
 * What needs somebody, and how many.
 *
 * ── Why the bell shows less than the list does ──────────────────────────────
 *
 * The badge counts only the *raised* signals — the ones that name something
 * actionable today and that clear themselves once the work is done. Everything
 * else the office is entitled to see is in the popover underneath, greyed to
 * the same weight as the rest, because a standing figure like «students with no
 * supervisor» is worth a row on a list somebody opened and is not worth
 * interrupting anybody over. A bell that is lit every morning is a bell nobody
 * reads, and that is the whole design.
 *
 * ── An unanswered count is not «nothing to do» ──────────────────────────────
 *
 * A signal that could not be counted is drawn neutral with a dash rather than a
 * zero, and the popover says so at the foot. The failure mode this avoids is
 * the only one that really matters here: a refused read rendering as a clean
 * bill of health.
 */

const ALERT_ICONS: Record<string, LucideIcon> = {
  fileWarning: FileWarning,
  calendarClock: CalendarClock,
  calendarDays: CalendarDays,
  clipboardList: ClipboardList,
  building: Building2,
  presentation: Presentation,
  stickyNote: StickyNote,
  userX: UserX,
  users: UserX,
  gauge: Gauge,
};

const ROW_TONES: Record<AttentionTone, string> = {
  danger: STATUS_TONES.danger,
  warning: STATUS_TONES.warning,
  success: STATUS_TONES.success,
  neutral: "bg-muted text-muted-foreground",
};

export function AlertsBell({
  signals,
  raisedCount,
  failed,
  locale,
  notificationUnreadCount,
}: {
  signals: AttentionSignal[];
  /** How many raised signals there are — what the badge counts. */
  raisedCount: number;
  failed: boolean;
  locale: string;
  notificationUnreadCount: number;
}) {
  const t = useTranslations("attention");
  const nt = useTranslations("notifications");
  const [open, setOpen] = useState(false);

  const digits = (value: number) => toLocaleDigits(String(value), locale);
  const badgeCount = raisedCount + notificationUnreadCount;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t("title")} className="relative">
            <Bell className="size-4" aria-hidden />
            {badgeCount > 0 && (
              /*
               * A dot with the count in it, not a number beside the icon: the
               * strip is 32px controls and a second glyph beside each one would
               * make the row read as eight buttons rather than four.
               */
              <span
                className={cn(
                  "absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-medium tabular-nums",
                  STATUS_TONES.danger,
                )}
                aria-hidden
              >
                {digits(badgeCount)}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className="w-88 overflow-hidden rounded-xl border border-border/80 bg-popover/95 p-0 shadow-xl backdrop-blur-md"
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3.5 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("title")}</p>
            <p className="text-xs text-muted-foreground">
              {raisedCount > 0 ? t("raised", { count: raisedCount }) : t("nothingRaised")}
            </p>
          </div>
          {badgeCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
              {t("urgentCount", { count: raisedCount })}
            </span>
          )}
        </div>

        {signals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="size-8 text-success/60 mb-2" />
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border/40 overflow-y-auto py-0.5">
            {signals.map((signal) => {
              const Icon = ALERT_ICONS[signal.icon] ?? Bell;
              return (
                <li key={signal.id}>
                  <Link
                    href={signal.href}
                    onClick={() => setOpen(false)}
                    className="group flex items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/60"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-black/5 dark:ring-white/10",
                        ROW_TONES[signal.tone],
                      )}
                    >
                      {/* Green means «checked, and nothing outstanding», which
                          is a claim worth a different glyph from the rule's
                          own. */}
                      {signal.tone === "success" ? (
                        <CheckCircle2 className="size-4" aria-hidden />
                      ) : (
                        <Icon className="size-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                          {t(signal.labelKey)}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 font-medium tabular-nums shadow-2xs",
                            signal.tone !== "neutral" && STATUS_TONES[signal.tone],
                          )}
                        >
                          {/* A dash, not a nought: «not counted» and «none» are
                              the same number and opposite claims. */}
                          {signal.ready ? digits(signal.count) : "—"}
                        </Badge>
                      </span>
                      {signal.hint && (
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                          {t(signal.hint.key, signal.hint.values)}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60"
        >
          <span>{nt("openCenter")}</span>
          <Badge variant="outline">{digits(notificationUnreadCount)}</Badge>
        </Link>

        {failed && (
          <p className="border-t border-border/60 bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground">
            {t("someUnread")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
