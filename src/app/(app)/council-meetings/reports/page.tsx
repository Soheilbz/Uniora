import { Activity, AlertTriangle, ClipboardList, Layers3, Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { PeriodStrip, ReportBand, ReportPage } from "@/components/reports/report-page";
import {
  type StudentAnalyticsBlock,
  StudentAnalyticsEngine,
} from "@/components/reports/student-analytics-charts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { parseIntegerParam } from "@/lib/input-limits.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { meetingReport, meetingYears } from "@/modules/reports/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("meetings.title") };
}

export default async function MeetingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const viewer = await requireCapability("council.view");
  const raw = (await searchParams).year;
  const asked = parseIntegerParam(raw);
  const years = await meetingYears(viewer.tenantId);
  const year = asked !== null && years.includes(asked) ? asked : null;
  const [report, t, month, nav, format, locale] = await Promise.all([
    meetingReport(viewer.tenantId, year),
    getTranslations("reports"),
    getTranslations("reports.month"),
    getTranslations("nav"),
    getFormatter(),
    getLocale(),
  ]);
  const figure = (value: number) => format.number(value);
  const percent = (ratio: number) =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0 });
  const digits = (value: string) => toLocaleDigits(value, locale);
  const yearLabels = Object.fromEntries(
    report.perYear.map((point) => [String(point.year), digits(String(point.year))]),
  );
  const categorical = (
    id: string,
    title: string,
    description: string,
    rows: { value: string; count: number }[],
    labels?: Record<string, string>,
  ): StudentAnalyticsBlock => ({
    id,
    type: rows.length <= 6 ? "composition" : "distribution",
    title,
    description,
    rows,
    labels: Object.fromEntries(
      rows.map((row) => [row.value, labels?.[row.value] ?? (row.value || t("noneRecorded"))]),
    ),
    empty: t("noneRecorded"),
  });
  const monthLabels = Object.fromEntries(
    report.perMonth.map((row) => {
      const position = Number(row.value);
      return [row.value, position >= 1 && position <= 12 ? month(String(position)) : row.value];
    }),
  );
  const mixLabels = {
    decisions: t("meetings.decisions"),
    rulings: t("meetings.rulings"),
    appointments: t("meetings.appointments"),
  };
  const gaps = [
    { key: "noAttendance", count: report.attention.noAttendance },
    { key: "noDeputy", count: report.attention.noDeputy },
    { key: "barren", count: report.attention.barren },
  ];

  return (
    <ReportPage
      title={t("meetings.title")}
      description={t("meetings.description")}
      back="/council-meetings"
      backLabel={t("meetings.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[
        { label: nav("councilMeetings"), href: "/council-meetings" },
        { label: t("action") },
      ]}
      printLabel={t("print")}
      period={
        <PeriodStrip
          years={years}
          current={year}
          hrefFor={(value) =>
            value === null ? "/council-meetings/reports" : `/council-meetings/reports?year=${value}`
          }
          allLabel={t("period.all")}
          label={t("period.label")}
          yearLabel={(value) => digits(String(value))}
        />
      }
    >
      <section
        aria-label={t("meetings.overview")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <StatCard
          label={nav("councilMeetings")}
          value={figure(report.totals.sittings)}
          icon={ClipboardList}
        />
        <StatCard
          label={t("meetings.business")}
          value={figure(report.totals.items)}
          hint={t("meetings.businessHint")}
          icon={Layers3}
        />
        <StatCard
          label={t("meetings.perSitting")}
          value={
            report.totals.sittings === 0
              ? "—"
              : figure(Math.round((report.totals.items / report.totals.sittings) * 10) / 10)
          }
          hint={t("meetings.perSittingHint")}
        />
        <StatCard
          label={t("meetings.averagePresent")}
          value={report.totals.averagePresent === null ? "—" : figure(report.totals.averagePresent)}
          hint={t("meetings.averagePresentHint")}
          icon={Users}
        />
        <StatCard
          label={t("meetings.attendanceRate")}
          value={
            report.totals.attendanceRate === null
              ? "—"
              : percent(report.totals.attendanceRate / 100)
          }
          hint={t("meetings.attendanceRateHint")}
          icon={Activity}
        />
      </section>

      <ReportBand
        title={t("meetings.rhythmTitle")}
        description={t("meetings.rhythmHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            {
              id: "sittings-trend",
              type: "trend",
              title: t("meetings.perYear"),
              description: t("meetings.perYearHint"),
              points: report.perYear,
              yearLabels,
              countLabel: nav("councilMeetings"),
              empty: t("noneRecorded"),
            },
            categorical(
              "items-by-year",
              t("meetings.itemsByYear"),
              t("meetings.itemsByYearHint"),
              report.perYear.map((point) => ({ value: String(point.year), count: point.items })),
              yearLabels,
            ),
            categorical(
              "months",
              t("meetings.perMonth"),
              t("meetings.perMonthHint"),
              report.perMonth,
              monthLabels,
            ),
          ]}
        />
      </ReportBand>

      <ReportBand
        title={t("meetings.activityTitle")}
        description={t("meetings.activityHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            categorical(
              "business-mix",
              t("meetings.mix"),
              t("meetings.mixHint"),
              report.businessMix,
              mixLabels,
            ),
            categorical("chairs", t("meetings.chairs"), t("meetings.chairsHint"), report.byChair, {
              "": t("meetings.noDeputy"),
            }),
            categorical(
              "locations",
              nav("councilMeetings"),
              t("meetings.locationsHint"),
              report.byLocation,
              { "": t("noneRecorded") },
            ),
          ]}
        />
      </ReportBand>

      <ReportBand
        title={t("meetings.qualityTitle")}
        description={t("meetings.attentionHint")}
        columns={1}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <PanelCard title={t("attention")}>
            <ul className="grid gap-x-6 divide-y sm:grid-cols-3 sm:divide-y-0">
              {gaps.map((gap) => (
                <li
                  key={gap.key}
                  className="flex min-w-0 items-start justify-between gap-3 border-border/70 py-3 first:pt-0 sm:border-b-0 sm:py-0"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                      {t(`meetings.${gap.key}`)}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {t(`meetings.${gap.key}Hint`)}
                    </span>
                  </span>
                  <span
                    className={`numeric shrink-0 text-lg font-semibold tabular-nums ${gap.count === 0 ? "text-muted-foreground" : ""}`}
                  >
                    {figure(gap.count)}
                  </span>
                </li>
              ))}
            </ul>
          </PanelCard>
          <PanelCard title={t("meetings.peak")} description={t("meetings.peakHint")}>
            {report.peak ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="rounded-lg bg-primary/10 p-2.5 text-primary" aria-hidden>
                  <Layers3 className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="numeric text-3xl font-bold tabular-nums">
                    {figure(report.peak.items)}
                  </p>
                  <p className="text-sm font-medium">
                    {t("meetings.itemsUnit")} ·{" "}
                    {report.peak.number ? digits(report.peak.number) : "—"}
                  </p>
                  {report.peak.date && (
                    <p className="numeric text-xs text-muted-foreground">
                      {format.dateTime(new Date(report.peak.date), { dateStyle: "medium" })}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
            )}
          </PanelCard>
        </div>
      </ReportBand>

      <ReportBand
        title={t("meetings.businessDetailTitle")}
        description={t("meetings.businessDetailHint")}
        columns={1}
      >
        <PanelCard title={t("meetings.business")}>
          {report.business.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {report.business.map((sitting) => (
                <li
                  key={`${sitting.number}-${sitting.date}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 px-3 py-2.5"
                >
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="numeric text-sm font-semibold">
                      {sitting.number ? digits(sitting.number) : "—"}
                    </span>
                    {sitting.date && (
                      <span className="numeric text-xs text-muted-foreground">
                        {format.dateTime(new Date(sitting.date), { dateStyle: "medium" })}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      sitting.items === 0
                        ? "numeric shrink-0 text-sm text-muted-foreground"
                        : "numeric shrink-0 text-sm tabular-nums"
                    }
                  >
                    {sitting.items === 0
                      ? t("meetings.barrenHint")
                      : `${figure(sitting.items)} ${t("meetings.itemsUnit")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </ReportBand>
    </ReportPage>
  );
}
