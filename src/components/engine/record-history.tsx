import { ArrowLeft, Clock, History, User } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { formatAuditValue, formatJalaliDateTime, translateField } from "@/lib/audit-formatters";
import { type RecordEvent, readRecordHistory } from "@/modules/settings/record-history.ts";

/**
 * The record's own slice of the event log.
 *
 * ── One trail, two readers ──────────────────────────────────────────────────
 *
 * The settings screen reads it across the institution and this reads the rows
 * belonging to one record, but they are the same rows and describe an event the
 * same way — including the fallback, where a key this build has no wording for
 * prints as itself rather than as an untranslated path.
 */

export interface HistoryWords {
  hint: string;
  empty: string;
  emptyHint: string;
  actorGone: string;
  /** An action in the office's words, falling back to the stored key. */
  action: (action: string) => string;
  /** A timestamp in the reader's calendar. */
  when: (at: Date) => string;
}

export function RecordHistory({
  events,
  words,
  locale,
}: {
  events: RecordEvent[];
  words: HistoryWords;
  locale: string;
}) {
  if (events.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{words.empty}</EmptyTitle>
          <EmptyDescription>{words.emptyHint}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{words.hint}</p>
      <ul className="flex flex-col gap-3">
        {events.map((event) => (
          <li
            key={event.id}
            className="rounded-xl border border-border/80 bg-card/95 p-4 shadow-2xs transition-all hover:border-primary/30"
          >
            {/* Header: Action Badge, Actor Name, Timestamp */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-semibold px-2.5 py-0.5">
                  {words.action(event.action)}
                </Badge>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <User className="size-3.5 text-muted-foreground" aria-hidden />
                  <span>{event.actorName ?? words.actorGone}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />
                <span>{words.when(event.createdAt)}</span>
              </div>
            </div>

            {/* Changes Detail List */}
            {event.changes.length > 0 && (
              <>
                <Separator className="my-3 border-border/60" />
                <div className="flex flex-col gap-2">
                  {event.changes.map((change) => {
                    const fieldName = translateField(change.field, locale);
                    const formattedFrom =
                      change.from !== null && change.from !== undefined
                        ? formatAuditValue(change.from, locale)
                        : null;
                    const formattedTo = formatAuditValue(change.to, locale);

                    return (
                      <div
                        key={change.field}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs"
                      >
                        <span className="font-semibold text-foreground/90 shrink-0">
                          {fieldName}:
                        </span>

                        <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                          {formattedFrom !== null && (
                            <>
                              <span className="text-foreground/70 line-through decoration-destructive/60">
                                {formattedFrom}
                              </span>
                              <ArrowLeft className="size-3 text-primary shrink-0" aria-hidden />
                            </>
                          )}
                          <span className="font-medium text-primary-foreground bg-primary/90 px-1.5 py-0.5 rounded-sm">
                            {formattedTo}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The history tab, assembled — events read and words resolved.
 */
export async function historyTab(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<{ value: string; label: string; content: React.ReactNode }> {
  const [events, t, settings, locale] = await Promise.all([
    readRecordHistory(tenantId, entityType, entityId),
    getTranslations("record"),
    getTranslations("settings"),
    getLocale(),
  ]);

  const action = (key: string) => {
    const path = `audit.action.${key}`;
    const message = settings(path);
    return message.endsWith(path) ? key : message;
  };

  return {
    value: "audit",
    label: t("history"),
    content: (
      <RecordHistory
        events={events}
        words={{
          hint: t("historyHint"),
          empty: t("historyEmpty"),
          emptyHint: t("historyEmptyHint"),
          actorGone: t("historyActorGone"),
          action,
          when: (at) => formatJalaliDateTime(at, locale),
        }}
        locale={locale}
      />
    ),
  };
}
