import { FileDown, Printer } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { formatAuditValue, formatJalaliDateTime, translateField } from "@/lib/audit-formatters";
import { can } from "@/lib/capabilities.ts";
import { singleParam } from "@/lib/register/params.ts";
import { isValidIsoDate } from "@/lib/register/validation.ts";
import { cn } from "@/lib/utils";
import { requireCapability } from "@/lib/viewer.ts";
import {
  type AuditEntry,
  type AuditQuery,
  readAudit,
  readAuditFacets,
} from "@/modules/settings/audit.ts";
import { ENTITY_PATH, groupAuditEntries, NOTABLE } from "@/modules/settings/audit-grouping.ts";

/**
 * The record of what was done.
 *
 * Every filter is in the address, so an auditor can send a colleague the exact
 * view they are looking at — «everything this person did last week» is a link.
 *
 * A Server Component with no client code at all: the filters are a plain GET
 * form and the pages are links. A log is read far more often than it is
 * narrowed, and shipping a table of fifty rows twice — once as HTML, once as
 * JSON for a client component to re-render — would double the cost of the
 * common case to speed up the rare one.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("audit.title") };
}

interface Params {
  actor?: string | string[];
  entity?: string | string[];
  from?: string | string[];
  to?: string | string[];
  q?: string | string[];
  cursor?: string | string[];
  dir?: string | string[];
}

/** A date as the filter accepts it: `YYYY-MM-DD`, or nothing. */
function asDate(value: string): string {
  return isValidIsoDate(value) ? value : "";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireCapability("audit.view");
  const params = await searchParams;

  /*
   * Every value is shaped before it reaches a query.
   *
   * The actor and the entity are compared against columns, and the dates are
   * cast to `date` in SQL — so a value that is not a date is not a filter, it
   * is a cast error on a public endpoint.
   */
  const query: AuditQuery = {
    actor: singleParam(params.actor),
    entity: singleParam(params.entity),
    from: asDate(singleParam(params.from)),
    to: asDate(singleParam(params.to)),
    /* Capped, because it is interpolated into a folded `LIKE` and a needle
       longer than any stored value can only ever match nothing slowly. */
    search: singleParam(params.q).slice(0, 120),
    cursor: singleParam(params.cursor).slice(0, 256),
    direction: singleParam(params.dir) === "prev" ? "prev" : "next",
  };

  const [log, facets, t, common, format, locale] = await Promise.all([
    readAudit(viewer.tenantId, query),
    readAuditFacets(viewer.tenantId),
    getTranslations("settings"),
    getTranslations("common"),
    getFormatter(),
    getLocale(),
  ]);

  const href = (cursor: string | null, direction: "next" | "prev") => {
    const next = new URLSearchParams();
    if (query.actor) next.set("actor", query.actor);
    if (query.entity) next.set("entity", query.entity);
    if (query.from) next.set("from", query.from);
    if (query.to) next.set("to", query.to);
    if (query.search) next.set("q", query.search);
    if (cursor) {
      next.set("cursor", cursor);
      next.set("dir", direction);
    }
    const search = next.toString();
    return search === "" ? "/settings/audit" : `/settings/audit?${search}`;
  };

  /* The same narrowing, handed to the printed sheet — so what comes out of the
     printer is what is on the screen and not the whole log. */
  const printQuery = (() => {
    const next = new URLSearchParams();
    if (query.actor) next.set("actor", query.actor);
    if (query.entity) next.set("entity", query.entity);
    if (query.from) next.set("from", query.from);
    if (query.to) next.set("to", query.to);
    if (query.search) next.set("q", query.search);
    if (query.cursor) {
      next.set("cursor", query.cursor);
      next.set("dir", query.direction);
    }
    const search = next.toString();
    return search === "" ? "" : `?${search}`;
  })();

  /*
   * A stored key in the office's words — or the key itself, where the log holds
   * something this build has no wording for.
   *
   * The trail outlives the code that wrote it: an event filed by an earlier
   * version under a name since renamed still has to render. Falling back to the
   * raw key shows an auditor something true rather than an empty cell.
   */
  const said = (key: string) => {
    const message = t(key);
    /*
     * next-intl reports a miss by returning the *full dotted path*, namespace
     * and all — not the bare key it was handed. Comparing against the key
     * therefore never matched, and an event type this build has no wording for
     * printed as `settings.audit.entity.calendar_entry` on an auditor's sheet.
     * The fallback is the raw stored key, which is at least true.
     */
    return message.endsWith(key) ? null : message;
  };
  const entityLabel = (type: string) => said(`audit.entity.${type}`) ?? type;
  const actionLabel = (action: string) => said(`audit.action.${action}`) ?? action;

  /*
   * Folded on the page rather than in SQL — see `groupAuditEntries` for why a
   * batch id written by the server would be the wrong answer.
   */
  const groups = groupAuditEntries(log.entries);

  /**
   * The head of a record id, and where the record has a page, the way there.
   *
   * Eight characters, not the whole identifier: nobody reads a UUID, and the
   * full one wrapped across two lines in a cell where it was the widest thing
   * on the row. It is a *reference* — enough for two people to point at the
   * same event — and where the kind of record has a screen it is the link it
   * was always pretending to be. Ids of things with no page stay plain text,
   * because a link that opens nothing is worse than no link.
   *
   * Pinned LTR so the bidi algorithm cannot reorder a hex fragment against the
   * Persian beside it.
   */
  const EntityRef = ({ entityType, entityId }: { entityType: string; entityId: string }) => {
    const head = (
      <span className="numeric" dir="ltr">
        {entityId.slice(0, 8)}
      </span>
    );
    const path = ENTITY_PATH[entityType]?.(entityId);
    if (!path) return head;
    return (
      <Link href={path} className="underline underline-offset-2 hover:text-foreground">
        {head}
      </Link>
    );
  };

  /**
   * The field-level diff, which is the whole point.
   *
   * «ویرایش دانشجو» tells an auditor nothing; «مقطع تحصیلی: کارشناسی ارشد ←
   * دکتری تخصصی» is what they came for. An empty value prints «—» rather than
   * nothing, so a cleared field reads as cleared rather than as a gap.
   */
  const Changes = ({ entry }: { entry: AuditEntry }) =>
    entry.changes.length === 0 ? null : (
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground mt-1">
        {entry.changes.map((change) => (
          <li
            key={change.field}
            className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1 text-xs"
          >
            <span className="font-semibold text-foreground/90">
              {translateField(change.field, locale)}:
            </span>
            {change.from !== null && change.from !== undefined && (
              <>
                <span className="text-foreground/70 line-through decoration-destructive/60">
                  {formatAuditValue(change.from, locale)}
                </span>
                <span aria-hidden className="text-primary">
                  ←
                </span>
              </>
            )}
            <span className="font-medium text-foreground">
              {formatAuditValue(change.to, locale)}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("audit.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("audit.subtitle")}</p>
        </div>
        {/*
         * The printed log carries this screen's own filters, so an auditor who
         * narrowed to one clerk and one fortnight prints that rather than the
         * whole book. A real link with the query string on it — which is also
         * what lets it be copied or opened in a second tab.
         */}
        <div className="flex flex-wrap gap-2">
          {/*
           * The same narrowing again, as a file.
           *
           * `data.export` and not `audit.view`: reading the trail on screen and
           * taking a copy of it out of the building are different acts, and the
           * second is one this log records about the person doing it.
           */}
          {can(viewer, "data.export") && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a href={`/settings/audit/export${printQuery}`} download>
                  <FileDown className="size-4" aria-hidden />
                  {t("audit.export")}
                </a>
              }
            />
          )}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href={`/print/audit${printQuery}`} target="_blank" rel="noreferrer">
                <Printer className="size-4" aria-hidden />
                {common("print")}
              </a>
            }
          />
        </div>
      </div>

      {/* A plain GET form: submitting it puts the filters in the address, which
          is where they belong and what makes the view shareable. */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        {/*
         * Free text, first, and wider than the rest.
         *
         * The three narrowing filters cut the trail by date, actor and kind —
         * and the question an auditor actually arrives with is usually none of
         * those: «what happened to the record ending 7f3a». Submitted with the
         * form rather than typed live, like everything else on this page, which
         * is why there is no client code here at all.
         */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("audit.searchLabel")}</span>
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder={t("audit.searchPlaceholder")}
            className="h-9 w-full max-w-64 rounded-md border bg-background px-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("audit.filter.actor")}</span>
          <select
            name="actor"
            defaultValue={query.actor}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t("audit.filter.actorAny")}</option>
            {facets.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("audit.column.entity")}</span>
          <select
            name="entity"
            defaultValue={query.entity}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t("audit.filter.entityAny")}</option>
            {facets.entities.map((entity) => (
              <option key={entity} value={entity}>
                {entityLabel(entity)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("audit.filter.from")}</span>
          <DatePicker
            name="from"
            defaultValue={query.from}
            placeholder={t("audit.filter.from")}
            ariaLabel={t("audit.filter.from")}
            className="w-full max-w-40"
          />
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("audit.filter.to")}</span>
          <DatePicker
            name="to"
            defaultValue={query.to}
            placeholder={t("audit.filter.to")}
            ariaLabel={t("audit.filter.to")}
            className="w-full max-w-40"
          />
        </div>

        <Button type="submit" size="sm">
          {t("audit.filter.apply")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/settings/audit">{t("audit.filter.clear")}</Link>}
        />
      </form>

      {/*
       * A list, not a table.
       *
       * The trail is not a grid of comparable values: an event carries a
       * sentence, a set of field diffs of wildly different lengths, and
       * sometimes a folded run of forty records. Four fixed columns squeeze all
       * of that into whatever the narrowest one allows, and the diff — the
       * whole reason this screen exists — ends up in a cell the reader has to
       * widen. A list gives each event the room its own content needs.
       */}
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {groups.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">{t("audit.empty")}</li>
        )}

        {groups.map((group) => {
          const { lead, members } = group;
          const folded = members.length > 1;

          const heading = (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                {/*
                 * Amber for the few actions that change what somebody may do,
                 * or that took a copy of the register out of the building. The
                 * rest are housekeeping and read as housekeeping — see
                 * `NOTABLE`, which is deliberately short.
                 */}
                <Badge
                  variant="outline"
                  className={cn(
                    "w-fit font-normal",
                    NOTABLE.has(lead.action) &&
                      "border-warning/40 bg-warning/10 text-warning-foreground",
                  )}
                >
                  {actionLabel(lead.action)}
                </Badge>
                <span className="text-sm font-medium">
                  {lead.actorName ?? (
                    <span className="text-muted-foreground">{t("audit.actor.system")}</span>
                  )}
                </span>
                {folded && (
                  <Badge variant="outline" className="w-fit font-normal text-muted-foreground">
                    {t("audit.groupRecords", { count: members.length })}
                  </Badge>
                )}
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                  {formatJalaliDateTime(lead.createdAt, locale)}
                </span>
              </div>

              {lead.entityType && (
                <p className="text-xs text-muted-foreground">
                  {entityLabel(lead.entityType)}
                  {/*
                   * A folded run names no single record — the disclosure below
                   * names all of them — so the reference is shown only when the
                   * line is about one.
                   */}
                  {!folded && lead.entityId && (
                    <>
                      {" · "}
                      <EntityRef entityType={lead.entityType} entityId={lead.entityId} />
                    </>
                  )}
                </p>
              )}

              {!folded && <Changes entry={lead} />}
            </div>
          );

          return (
            <li key={lead.id} className="p-3">
              {folded ? (
                /*
                 * `<details>` rather than React state, because a folded run is
                 * a document affordance: it prints open, the browser's own
                 * find-in-page reaches inside it, and it needs no keyboard
                 * handling written by hand. It is also why this page still
                 * ships no client JavaScript.
                 */
                <details className="group">
                  <summary className="cursor-pointer list-none">{heading}</summary>
                  <ul className="mt-2 flex flex-col gap-2 border-s ps-3">
                    {members.map((member) => (
                      <li key={member.id} className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">
                          {member.entityId && (
                            <EntityRef entityType={member.entityType} entityId={member.entityId} />
                          )}
                        </span>
                        <Changes entry={member} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                heading
              )}
            </li>
          );
        })}
      </ul>

      {(log.entries.length > 0 || log.hasPrevious || log.hasNext) && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {format.number(log.entries.length)} {t("audit.eventsOnPage")}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={!log.hasPrevious}
              render={<Link href={href(log.previousCursor, "prev")}>{"‹"}</Link>}
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              disabled={!log.hasNext}
              render={<Link href={href(log.nextCursor, "next")}>{"›"}</Link>}
            />
          </div>
        </div>
      )}
    </div>
  );
}
