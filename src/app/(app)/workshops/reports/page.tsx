import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AdmissionsChart, PanelCard, StatCard } from "@/components/dashboard/panels";
import { PeriodStrip, ReportBand, ReportPage } from "@/components/reports/report-page";
import { Tally } from "@/components/reports/tally";
import { toLocaleDigits } from "@/lib/digits.ts";
import { parseIntegerParam } from "@/lib/input-limits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { requireCapability } from "@/lib/viewer.ts";
import { workshopReport, workshopYears } from "@/modules/reports/queries.ts";

/** What the workshops enrolled, who turned up, and what was issued. */

/**
 * The four conditions the attention band names, in reading order.
 *
 * Certificates first and in all three of their shapes, because that is the one
 * thing this office is actually chased about — someone attended and has nothing
 * to show for it. Capacity last: it is a planning fault rather than a debt.
 */
const GAPS = [
  "certificatesOutstanding",
  "certificatesUnearned",
  "certificatesOnCancelled",
  "overSubscribed",
] as const;

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("workshops.title") };
}

export default async function WorkshopReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const viewer = await requireCapability("workshops.view");

  const raw = (await searchParams).year;
  const asked = parseIntegerParam(raw);

  const years = await workshopYears(viewer.tenantId);
  const year = asked !== null && years.includes(asked) ? asked : null;

  const [report, t, nav, workshops, format, locale, lookups] = await Promise.all([
    workshopReport(viewer.tenantId, year),
    getTranslations("reports"),
    getTranslations("nav"),
    getTranslations("workshops"),
    getFormatter(),
    getLocale(),
    lookupTable(viewer.tenantId, ["workshop_statuses"]),
  ]);

  const figure = (value: number) => format.number(value);
  const percent = (ratio: number) =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0 });

  /*
   * The attendance rate, computed here and not in SQL.
   *
   * It is a ratio of two figures printed beside it, and a percentage that
   * disagreed with them would be worse than no percentage at all.
   */
  const rate =
    report.totals.registered === 0
      ? null
      : Math.round((report.totals.attended / report.totals.registered) * 100);

  return (
    <ReportPage
      title={t("workshops.title")}
      description={t("workshops.eachHint")}
      back="/workshops"
      backLabel={t("workshops.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[{ label: workshops("title"), href: "/workshops" }, { label: t("action") }]}
      printLabel={t("print")}
      period={
        <PeriodStrip
          years={years}
          current={year}
          hrefFor={(value) =>
            value === null ? "/workshops/reports" : `/workshops/reports?year=${value}`
          }
          allLabel={t("period.all")}
          label={t("period.label")}
          yearLabel={(value) => toLocaleDigits(String(value), locale)}
        />
      }
    >
      <section aria-label={t("workshops.title")} className="grid gap-4 sm:grid-cols-4">
        <StatCard label={t("workshops.total")} value={figure(report.totals.workshops)} />
        <StatCard label={t("workshops.registered")} value={figure(report.totals.registered)} />
        <StatCard
          label={t("workshops.attended")}
          value={
            rate === null
              ? figure(report.totals.attended)
              : `${figure(report.totals.attended)} · ${percent(rate / 100)}`
          }
        />
        <StatCard label={t("workshops.certificates")} value={figure(report.totals.certificates)} />
      </section>

      <ReportBand title={t("workshops.byStatus")}>
        <PanelCard title={t("workshops.byStatus")}>
          <Tally
            rows={report.byStatus}
            label={(value) =>
              value === ""
                ? t("noneRecorded")
                : (lookups.get("workshop_statuses")?.find((entry) => entry.value === value)
                    ?.label ?? value)
            }
            figure={figure}
            empty={t("noneRecorded")}
          />
        </PanelCard>

        <PanelCard title={t("workshops.byYear")}>
          <AdmissionsChart
            years={report.byYear}
            labelFor={(value) => toLocaleDigits(String(value), locale)}
            caption={t("workshops.byYearCaption")}
            emptyLabel={t("noneRecorded")}
          />
        </PanelCard>
      </ReportBand>

      <ReportBand title={t("workshops.each")} description={t("workshops.eachHint")} columns={1}>
        <PanelCard title={t("workshops.each")}>
          {report.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {report.rows.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/workshops/${row.id}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {row.title}
                    </Link>
                    {row.date && (
                      <span className="numeric text-xs text-muted-foreground">
                        {format.dateTime(new Date(row.date), { dateStyle: "medium" })}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                    <span>
                      {t("workshops.registered")}:{" "}
                      <span className="numeric">{figure(row.registered)}</span>
                    </span>
                    <span>
                      {t("workshops.attended")}:{" "}
                      <span className="numeric">{figure(row.attended)}</span>
                    </span>
                    <span>
                      {t("workshops.certificates")}:{" "}
                      <span className="numeric">{figure(row.certificates)}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </ReportBand>

      {/*
       * Deliberately the largest thing on the page. The current workflow blocks
       * new certificates unless a workshop is held and the participant attended;
       * these counters remain valuable because imported or historical data can
       * still predate those controls, and stale workshop status is an operational
       * quality issue rather than something reporting should hide.
       *
       * Every row is a list, not a statistic. See `workshopReport` for the two
       * conditions the register also counts and this does not,
       * because the database refuses them outright.
       */}
      <ReportBand title={t("attention")} description={t("workshops.attentionHint")} columns={1}>
        <PanelCard title={t("attention")}>
          <ul className="flex flex-col divide-y">
            {GAPS.map((key) => (
              <li key={key} className="flex items-start justify-between gap-3 py-2.5">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{t(`workshops.${key}`)}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {t(`workshops.${key}Hint`)}
                  </span>
                </span>
                {/* Muted at zero — «nothing to do» should not read with the
                    same weight as «eleven people are owed a certificate». */}
                <span
                  className={cn(
                    "numeric shrink-0 text-lg font-semibold tabular-nums",
                    report.gaps[key] === 0 && "text-muted-foreground",
                  )}
                >
                  {figure(report.gaps[key])}
                </span>
              </li>
            ))}
          </ul>
        </PanelCard>
      </ReportBand>
    </ReportPage>
  );
}
