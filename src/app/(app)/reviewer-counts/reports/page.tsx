import { ListTree, TriangleAlert, Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { PeriodStrip, ReportBand, ReportPage } from "@/components/reports/report-page";
import { Tally } from "@/components/reports/tally";
import { toLocaleDigits } from "@/lib/digits.ts";
import { parseIntegerParam } from "@/lib/input-limits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { requireCapability } from "@/lib/viewer.ts";
import { readReviewerCounts } from "@/modules/capacity/reviewers.ts";
import { reviewReport, reviewYears } from "@/modules/reports/queries.ts";

/**
 * The examining, as the minutes record it.
 *
 * ── Why both capabilities ───────────────────────────────────────────────────
 *
 * It reads the council's minutes for who was appointed and the professor
 * directory to say which of those names the institution recognises. The screen
 * it is reached from asks for the same pair, and for the same reason: a report
 * that could resolve only half its names would report the rest as guests.
 *
 * ── Period scope ────────────────────────────────────────────────────────────
 *
 * The optional Jalali year is part of the URL and scopes both the examiner
 * tally and the operational KPI panels. "All" remains the complete archive;
 * a selected year is therefore a deliberate slice, not a second unexplained
 * definition of the headline figure.
 */

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("reviews.title") };
}

export default async function ReviewReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const viewer = await requireCapability("council.view", "professors.view");
  const raw = (await searchParams).year;
  const asked = parseIntegerParam(raw);
  const years = await reviewYears(viewer.tenantId);
  const year = asked !== null && years.includes(asked) ? asked : null;

  const [rows, report, t, nav, format, locale, lookups] = await Promise.all([
    readReviewerCounts(viewer.tenantId, year),
    reviewReport(viewer.tenantId, year),
    getTranslations("reports"),
    getTranslations("nav"),
    getFormatter(),
    getLocale(),
    lookupTable(viewer.tenantId, ["degrees"]),
  ]);

  const figure = (value: number) => format.number(value);
  const percent = (ratio: number) =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0 });

  const examining = rows.filter((row) => row.reviews > 0);
  const ranked = [...examining].sort((left, right) => right.reviews - left.reviews);
  const totalCases = examining.reduce((sum, row) => sum + row.reviews, 0);
  const topTen = ranked.slice(0, 10).reduce((sum, row) => sum + row.reviews, 0);

  /*
   * A name the council minuted that the directory does not hold.
   *
   * A guest examiner from another university and a spelling nobody has
   * reconciled are indistinguishable from here, and the report says so rather
   * than guessing which.
   */
  const unresolved = examining.filter((row) => row.professorId === null).length;

  const gaps = [
    { key: "noRepresentative", count: report.attention.noRepresentative },
    { key: "outstanding", count: report.attention.outstanding },
  ];

  return (
    <ReportPage
      title={t("reviews.title")}
      description={t("reviews.description")}
      back="/reviewer-counts"
      backLabel={t("reviews.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[
        { label: nav("reviewerCounts"), href: "/reviewer-counts" },
        { label: t("action") },
      ]}
      printLabel={t("print")}
      period={
        <PeriodStrip
          years={years}
          current={year}
          hrefFor={(value) =>
            value === null ? "/reviewer-counts/reports" : `/reviewer-counts/reports?year=${value}`
          }
          allLabel={t("period.all")}
          label={t("period.label")}
          yearLabel={(value) => toLocaleDigits(String(value), locale)}
        />
      }
    >
      <section aria-label={t("reviews.title")} className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label={t("reviews.examiners")}
          value={figure(examining.length)}
          hint={t("reviews.examinersHint", { decisions: figure(report.decisions) })}
          icon={Users}
        />
        <StatCard label={t("reviews.caseUnit")} value={figure(totalCases)} icon={ListTree} />
        <StatCard
          label={t("reviews.concentration")}
          value={totalCases === 0 ? "—" : percent(topTen / totalCases)}
          hint={t("reviews.concentrationHint")}
        />
        <StatCard
          label={t("reviews.unresolved")}
          value={figure(unresolved)}
          hint={t("reviews.unresolvedHint")}
          icon={TriangleAlert}
        />
      </section>

      <ReportBand title={t("reviews.pace.title")}>
        <PanelCard title={t("reviews.pace.title")}>
          <div className="flex flex-col gap-2.5">
            {[
              {
                label: t("reviews.paceAverage"),
                hint: t("reviews.paceAverageHint", { cases: figure(report.paceCases) }),
                value: report.pace.average,
              },
              {
                label: t("reviews.paceMedian"),
                hint: t("reviews.paceMedianHint"),
                value: report.pace.median,
              },
              {
                label: t("reviews.paceLongest"),
                hint: t("reviews.paceLongestHint"),
                value: report.pace.longest,
              },
            ].map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="text-sm">{row.label}</div>
                  <div className="text-xs leading-relaxed text-muted-foreground">{row.hint}</div>
                </div>
                <span className="numeric shrink-0 text-lg font-semibold tabular-nums">
                  {row.value === null ? "—" : format.number(row.value)}
                </span>
              </div>
            ))}
          </div>
        </PanelCard>

        <PanelCard title={t("reviews.paceSpread")} description={t("reviews.paceSpreadHint")}>
          <Tally
            rows={report.paceSpread}
            label={(value) => t(`reviews.pace.${value}`)}
            figure={figure}
            empty={t("noneRecorded")}
          />
        </PanelCard>
      </ReportBand>

      <ReportBand title={t("reviews.busiest")}>
        <PanelCard title={t("reviews.busiest")} description={t("reviews.busiestHint")}>
          <Tally
            rows={ranked.slice(0, 12).map((row) => ({ value: row.name, count: row.reviews }))}
            label={(value) => value}
            figure={figure}
            empty={t("noneRecorded")}
          />
        </PanelCard>

        <PanelCard title={t("reviews.levels")} description={t("reviews.levelsHint")}>
          <Tally
            rows={report.byLevel}
            label={(value) =>
              value === ""
                ? t("noneRecorded")
                : (lookups.get("degrees")?.find((entry) => entry.value === value)?.label ?? value)
            }
            figure={figure}
            empty={t("noneRecorded")}
          />
        </PanelCard>
      </ReportBand>

      <ReportBand title={t("reviews.everyone")} description={t("reviews.everyoneHint")} columns={1}>
        <PanelCard title={t("reviews.everyone")}>
          {/*
           * The complete list, not the top ten.
           *
           * This is the panel an office prints and signs at the end of a term,
           * so a cut-off would make it useless for the one job it has.
           */}
          {ranked.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {ranked.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm">{row.name}</span>
                    {row.professorId === null && (
                      <span className="text-xs text-muted-foreground">
                        {t("reviews.unresolved")}
                      </span>
                    )}
                  </span>
                  <span className="numeric shrink-0 text-sm tabular-nums">
                    {figure(row.reviews)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </ReportBand>

      <ReportBand title={t("attention")} description={t("reviews.attentionHint")} columns={1}>
        <PanelCard title={t("attention")}>
          <ul className="flex flex-col divide-y">
            {gaps.map((gap) => (
              <li key={gap.key} className="flex items-start justify-between gap-3 py-2.5">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{t(`reviews.${gap.key}`)}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {t(`reviews.${gap.key}Hint`)}
                  </span>
                </span>
                <span
                  className={cn(
                    "numeric shrink-0 text-lg font-semibold tabular-nums",
                    gap.count === 0 && "text-muted-foreground",
                  )}
                >
                  {figure(gap.count)}
                </span>
              </li>
            ))}
          </ul>
        </PanelCard>
      </ReportBand>
    </ReportPage>
  );
}
