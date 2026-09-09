import { CircleAlert, Gauge, UserRound, UsersRound } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { ReportBand, ReportPage } from "@/components/reports/report-page";
import {
  type StudentAnalyticsBlock,
  StudentAnalyticsEngine,
} from "@/components/reports/student-analytics-charts";
import { lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { requireCapability } from "@/lib/viewer.ts";
import { readCapacityExplanations } from "@/modules/capacity/queries.ts";
import { professorReport } from "@/modules/reports/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("professors.title") };
}

export default async function ProfessorReportsPage() {
  const viewer = await requireCapability("professors.view");
  const [report, capacityReading, t, nav, professors, format, lookups] = await Promise.all([
    professorReport(viewer.tenantId),
    readCapacityExplanations(viewer.tenantId),
    getTranslations("reports"),
    getTranslations("nav"),
    getTranslations("professors"),
    getFormatter(),
    lookupTable(viewer.tenantId, [
      "professor_statuses",
      "academic_ranks",
      "faculties",
      "departments",
      "universities",
    ]),
  ]);

  const figure = (value: number) => format.number(value);
  const percent = (ratio: number) =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0 });
  const engineRows = [...capacityReading.explanations.values()].map((explanation) => {
    const tables = [explanation.dissertation, explanation.thesis];
    const used = tables.reduce((sum, table) => sum + table.used + table.internationalUsed, 0);
    const quota = tables.reduce(
      (sum, table) => sum + (table.allowance ?? 0) + (table.internationalAllowance ?? 0),
      0,
    );
    const professor = capacityReading.names.get(explanation.professorId);
    return {
      name: professor?.name || explanation.professorId,
      students: used,
      quota: tables.some(
        (table) => table.allowance !== null || table.internationalAllowance !== null,
      )
        ? quota
        : null,
      provisional: explanation.provisional,
    };
  });
  const engineSpread = [
    { value: "none", count: 0 },
    { value: "few", count: 0 },
    { value: "some", count: 0 },
    { value: "many", count: 0 },
  ];
  for (const row of engineRows) {
    const bucket =
      row.students === 0 ? "none" : row.students <= 2 ? "few" : row.students <= 5 ? "some" : "many";
    const target = engineSpread.find((entry) => entry.value === bucket);
    if (target) target.count += 1;
  }
  const engineCapacity = ["noQuota", "within", "nearLimit", "exceeded"].map((value) => ({
    value,
    count: 0,
  }));
  for (const row of engineRows) {
    const value =
      row.quota === null
        ? "noQuota"
        : row.students > row.quota
          ? "exceeded"
          : row.quota > 0 && row.students / row.quota >= 0.8
            ? "nearLimit"
            : "within";
    const bucket = engineCapacity.find((entry) => entry.value === value);
    if (bucket) bucket.count += 1;
  }
  const engineHeaviest = engineRows
    .filter((row) => row.students > 0)
    .sort((a, b) => b.students - a.students)
    .slice(0, 10);
  const engineSupervising = engineRows.filter((row) => row.students > 0).length;
  const coverage =
    report.totals.professors === 0
      ? 0
      : Math.round((engineSupervising / report.totals.professors) * 100);
  const worded = (set: string) => (value: string) =>
    value === ""
      ? t("noneRecorded")
      : (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value);
  const categorical = (
    id: string,
    title: string,
    description: string,
    rows: { value: string; count: number }[],
    set?: string,
    explicitLabels?: Record<string, string>,
  ): StudentAnalyticsBlock => ({
    id,
    type: rows.length <= 6 ? "composition" : "distribution",
    title,
    description,
    rows,
    labels: Object.fromEntries(
      rows.map((row) => [
        row.value,
        explicitLabels?.[row.value] ?? (set ? worded(set)(row.value) : row.value),
      ]),
    ),
    empty: t("noneRecorded"),
  });
  const gaps = [
    { key: "idle", count: report.attention.idle },
    { key: "noQuota", count: report.attention.noQuota },
    { key: "noDepartment", count: report.attention.noDepartment },
    { key: "noSpecialisation", count: report.attention.noSpecialisation },
    { key: "unresolved", count: report.attention.unresolved },
  ];

  return (
    <ReportPage
      title={t("professors.title")}
      description={t("professors.description")}
      back="/professors"
      backLabel={t("professors.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[{ label: professors("title"), href: "/professors" }, { label: t("action") }]}
      printLabel={t("print")}
    >
      <section
        aria-label={t("professors.overview")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label={nav("professors")}
          value={figure(report.totals.professors)}
          icon={UserRound}
        />
        <StatCard
          label={t("professors.supervising")}
          value={figure(engineSupervising)}
          hint={t("professors.supervisingHint")}
          icon={UsersRound}
        />
        <StatCard
          label={t("professors.coverage")}
          value={percent(coverage / 100)}
          hint={t("professors.coverageHint")}
          icon={Gauge}
        />
        <StatCard
          label={t("professors.reviews")}
          value={figure(report.totals.reviews)}
          hint={t("professors.reviewsHint")}
          icon={CircleAlert}
        />
      </section>

      <ReportBand
        title={t("professors.profileTitle")}
        description={t("professors.profileHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            categorical(
              "status",
              t("professors.byStatus"),
              t("professors.statusHint"),
              report.byStatus,
              "professor_statuses",
            ),
            categorical(
              "rank",
              t("professors.rankMix"),
              t("professors.rankMixHint"),
              report.byRank,
              "academic_ranks",
            ),
            categorical(
              "faculty",
              t("professors.byFaculty"),
              t("professors.byFacultyHint"),
              report.byFaculty,
              "faculties",
            ),
            categorical(
              "department",
              t("professors.byDepartment"),
              t("professors.byDepartmentHint"),
              report.byDepartment,
              "departments",
            ),
            categorical(
              "university",
              t("professors.byUniversity"),
              t("professors.byUniversityHint"),
              report.byUniversity,
              "universities",
            ),
          ]}
        />
      </ReportBand>

      <ReportBand
        title={t("professors.workloadTitle")}
        description={t("professors.workloadHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            categorical(
              "spread",
              t("professors.spread"),
              t("professors.spreadHint"),
              engineSpread,
              undefined,
              {
                none: t("professors.load.none"),
                few: t("professors.load.few"),
                some: t("professors.load.some"),
                many: t("professors.load.many"),
              },
            ),
            categorical(
              "capacity",
              t("professors.capacity"),
              t("professors.capacityHint"),
              engineCapacity,
              undefined,
              {
                noQuota: t("professors.capacityNoQuota"),
                within: t("professors.capacityWithin"),
                nearLimit: t("professors.capacityNearLimit"),
                exceeded: t("professors.capacityExceeded"),
              },
            ),
            categorical(
              "busiest",
              t("professors.busiest"),
              t("professors.busiestHint"),
              report.busiest.map((row) => ({ value: row.name, count: row.reviews })),
            ),
          ]}
        />
        <PanelCard title={t("professors.heaviest")} description={t("professors.heaviestHint")}>
          {engineHeaviest.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
          ) : (
            <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {engineHeaviest.map((row) => (
                <li key={row.name} className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
                    <span className="numeric shrink-0 text-xs tabular-nums">
                      {row.quota === null
                        ? t("professors.noAllowance", { used: figure(row.students) })
                        : t("professors.ofAllowance", {
                            used: figure(row.students),
                            quota: figure(row.quota),
                          })}
                    </span>
                  </div>
                  <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        row.quota !== null && row.students > row.quota
                          ? "bg-destructive/70"
                          : "bg-primary/70",
                      )}
                      style={{
                        width: `${Math.min(
                          100,
                          (row.students / Math.max(row.quota ?? row.students, 1)) * 100,
                        )}%`,
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
        title={t("professors.qualityTitle")}
        description={t("professors.attentionHint")}
        columns={1}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.75fr)]">
          <PanelCard title={t("attention")}>
            <ul className="grid gap-x-6 divide-y sm:grid-cols-2 sm:divide-y-0">
              {gaps.map((gap) => (
                <li
                  key={gap.key}
                  className="report-metric-row flex items-start justify-between gap-3 border-border/70 py-3 first:pt-0 sm:border-b sm:even:border-b-0"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm">{t(`professors.${gap.key}`)}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {t(`professors.${gap.key}Hint`)}
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
          <PanelCard
            title={t("professors.concentration")}
            description={t("professors.concentrationHint")}
          >
            <p className="numeric text-4xl font-semibold tabular-nums">
              {report.concentration === null ? "—" : percent(report.concentration / 100)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("professors.concentrationHint")}
            </p>
          </PanelCard>
        </div>
      </ReportBand>
    </ReportPage>
  );
}
