import { AlertTriangle, Gauge, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { ReportBand, ReportPage } from "@/components/reports/report-page";
import {
  type StudentAnalyticsBlock,
  StudentAnalyticsEngine,
} from "@/components/reports/student-analytics-charts";
import { lookupTable } from "@/lib/lookups.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { professorReport } from "@/modules/reports/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("capacityReports.title") };
}

export default async function ProfessorCapacityReportsPage() {
  const viewer = await requireCapability("capacity.view");
  const [report, t, nav, format, lookups] = await Promise.all([
    professorReport(viewer.tenantId),
    getTranslations("reports"),
    getTranslations("nav"),
    getFormatter(),
    lookupTable(viewer.tenantId, ["academic_ranks"]),
  ]);
  const figure = (value: number) => format.number(value);
  const percent = (ratio: number) =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0 });
  const worded = (value: string) =>
    value === ""
      ? t("noneRecorded")
      : (lookups.get("academic_ranks")?.find((entry) => entry.value === value)?.label ?? value);
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
      rows.map((row) => [row.value, labels?.[row.value] ?? worded(row.value)]),
    ),
    empty: t("noneRecorded"),
  });
  const distributionLabels = {
    noQuota: t("professors.capacityNoQuota"),
    within: t("professors.capacityWithin"),
    nearLimit: t("professors.capacityNearLimit"),
    exceeded: t("professors.capacityExceeded"),
  };
  const loadLabels = {
    none: t("professors.load.none"),
    few: t("professors.load.few"),
    some: t("professors.load.some"),
    many: t("professors.load.many"),
  };
  const over = report.capacityDistribution.find((row) => row.value === "exceeded")?.count ?? 0;
  const noQuota = report.capacityDistribution.find((row) => row.value === "noQuota")?.count ?? 0;
  const gaps = [
    { key: "noQuota", count: report.attention.noQuota },
    { key: "noDepartment", count: report.attention.noDepartment },
    { key: "idle", count: report.attention.idle },
    { key: "noSpecialisation", count: report.attention.noSpecialisation },
  ];
  return (
    <ReportPage
      title={t("capacityReports.title")}
      description={t("capacityReports.description")}
      back="/professor-capacity"
      backLabel={t("capacityReports.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[
        { label: nav("professorCapacity"), href: "/professor-capacity" },
        { label: t("action") },
      ]}
      printLabel={t("print")}
    >
      <section
        aria-label={t("capacityReports.overview")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label={t("professors.supervising")}
          value={figure(report.totals.supervising)}
          hint={t("professors.supervisingHint")}
          icon={Users}
        />
        <StatCard
          label={t("professors.capacityExceeded")}
          value={figure(over)}
          icon={AlertTriangle}
        />
        <StatCard label={t("professors.capacityNoQuota")} value={figure(noQuota)} icon={Gauge} />
        <StatCard
          label={t("professors.coverage")}
          value={
            report.totals.professors
              ? percent(report.totals.supervising / report.totals.professors)
              : "—"
          }
        />
      </section>
      <ReportBand
        title={t("capacityReports.loadTitle")}
        description={t("capacityReports.loadHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            categorical(
              "capacity-standing",
              t("professors.capacity"),
              t("professors.capacityHint"),
              report.capacityDistribution,
              distributionLabels,
            ),
            categorical(
              "load-spread",
              t("professors.spread"),
              t("professors.spreadHint"),
              report.spread,
              loadLabels,
            ),
            categorical(
              "departments",
              t("professors.byDepartment"),
              t("professors.byDepartmentHint"),
              report.byDepartment,
            ),
          ]}
        />
        <PanelCard title={t("professors.heaviest")} description={t("professors.heaviestHint")}>
          {report.heaviest.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {report.heaviest.map((row) => (
                <li key={row.name} className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium">{row.name}</span>
                    <span className="numeric shrink-0 text-xs tabular-nums">
                      {row.quota === null
                        ? t("professors.noAllowance", { used: figure(row.students) })
                        : t("professors.ofAllowance", {
                            used: figure(row.students),
                            quota: figure(row.quota),
                          })}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${row.quota !== null && row.students > row.quota ? "bg-destructive/70" : "bg-primary/70"}`}
                      style={{
                        width: `${Math.min(100, (row.students / Math.max(row.quota ?? row.students, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </ReportBand>
      <ReportBand
        title={t("capacityReports.qualityTitle")}
        description={t("capacityReports.qualityHint")}
        columns={1}
      >
        <PanelCard title={t("attention")}>
          <ul className="grid gap-x-6 divide-y sm:grid-cols-2 lg:grid-cols-4 sm:divide-y-0">
            {gaps.map((gap) => (
              <li key={gap.key} className="flex items-start justify-between gap-3 py-3">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                    {t(`professors.${gap.key}`)}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {t(`professors.${gap.key}Hint`)}
                  </span>
                </span>
                <span className="numeric shrink-0 text-lg font-semibold tabular-nums">
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
