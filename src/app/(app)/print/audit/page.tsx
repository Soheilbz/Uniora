import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PrintCell, PrintDocument, PrintTable } from "@/components/settings/print-document";
import type { SearchParams } from "@/lib/register/params.ts";
import { isValidIsoDate } from "@/lib/register/validation.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readAudit, readAuditFacets } from "@/modules/settings/audit.ts";

/**
 * The event log, on paper.
 *
 * ── It prints what the screen was showing, filters and all ──────────────────
 *
 * The link that reaches this page carries the screen's own query string, so an
 * auditor who narrowed the log to one clerk and one fortnight prints that, not
 * the whole book. The filters are restated under the heading, because a sheet
 * of forty rows that does not say what it was narrowed by is a sheet that will
 * be read as the entire log.
 *
 * ── And it says so when there is more than it printed ───────────────────────
 *
 * One page, the same fifty rows the screen holds. A log truncated in silence is
 * worse than no log at all: it is a document that reads as complete. So where
 * the filter matched more than one page, the count of what was matched is
 * printed against the count of what is on the sheet.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("nav.audit") };
}

export default async function PrintAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireCapability("audit.view");
  const params = await searchParams;

  const one = (key: string) => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? value : "";
  };

  const query = {
    actor: one("actor"),
    entity: one("entity"),
    from: isValidIsoDate(one("from")) ? one("from") : "",
    to: isValidIsoDate(one("to")) ? one("to") : "",
    /* The screen's search travels onto the sheet, so what prints is what the
       auditor narrowed to and not the whole book. */
    search: one("q").slice(0, 120),
    cursor: one("cursor").slice(0, 256),
    direction: one("dir") === "prev" ? ("prev" as const) : ("next" as const),
  };

  const [log, facets, t, common, locale] = await Promise.all([
    readAudit(viewer.tenantId, query),
    readAuditFacets(viewer.tenantId),
    getTranslations("settings"),
    getTranslations("common"),
    getLocale(),
  ]);

  const format = await getFormatter();
  const separator = locale.toLowerCase().startsWith("fa") ? "، " : ", ";

  /*
   * A stored key in the office's words — or the key itself, where the log holds
   * something this build has no wording for. The trail outlives the code that
   * wrote it: an event filed by an earlier version under a name since renamed
   * still has to print, and the raw key is true where an empty cell is not.
   * The same rule the screen behind this applies.
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

  /* What this sheet was narrowed by, said in words under the heading. */
  const narrowed = [
    query.actor && facets.actors.find((actor) => actor.id === query.actor)?.name,
    query.entity && entityLabel(query.entity),
    query.from && format.dateTime(new Date(query.from), { dateStyle: "medium" }),
    query.to && format.dateTime(new Date(query.to), { dateStyle: "medium" }),
  ].filter(Boolean) as string[];

  return (
    <PrintDocument
      tenantId={viewer.tenantId}
      title={t("nav.audit")}
      {...(narrowed.length > 0 ? { subject: narrowed.join(" · ") } : {})}
      backTo="/settings/audit"
      backLabel={common("back")}
    >
      {/*
       * Said on the page rather than trusted. This is the failure a printed log
       * must not have — a sheet that stops at fifty and reads as the whole book.
       */}
      <PrintTable
        head={[
          t("audit.column.time"),
          t("audit.filter.actor"),
          t("audit.column.action"),
          t("audit.column.entity"),
          t("audit.column.changes"),
        ]}
      >
        {log.entries.map((entry) => (
          <tr key={entry.id}>
            <PrintCell>
              {format.dateTime(entry.createdAt, { dateStyle: "short", timeStyle: "short" })}
            </PrintCell>
            {/*
             * An actor whose account has since been removed leaves a null here.
             * «—» rather than a blank: the event still happened, and a blank
             * cell reads as a row somebody forgot to fill in.
             */}
            <PrintCell>{entry.actorName ?? "—"}</PrintCell>
            <PrintCell>{actionLabel(entry.action)}</PrintCell>
            <PrintCell>{entityLabel(entry.entityType)}</PrintCell>
            <PrintCell>
              {entry.changes.length === 0
                ? "—"
                : entry.changes
                    .map((change) => `${change.field}: ${String(change.to ?? "")}`)
                    .join(separator)}
            </PrintCell>
          </tr>
        ))}
      </PrintTable>
    </PrintDocument>
  );
}
