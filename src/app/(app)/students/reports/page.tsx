import { CircleAlert, GraduationCap, Users } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { ReportBand, ReportPage } from "@/components/reports/report-page";
import { CompletenessCard } from "@/components/reports/student-analytics";
import {
  type StudentAnalyticsBlock,
  StudentAnalyticsEngine,
} from "@/components/reports/student-analytics-charts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { studentReport } from "@/modules/reports/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("students.title") };
}

export default async function StudentReportsPage() {
  const viewer = await requireCapability("students.view");
  const [report, t, nav, students, format, locale, lookups] = await Promise.all([
    studentReport(viewer.tenantId),
    getTranslations("reports"),
    getTranslations("nav"),
    getTranslations("students"),
    getFormatter(),
    getLocale(),
    lookupTable(viewer.tenantId, [
      "student_statuses",
      "degrees",
      "fields_of_study",
      "faculties",
      "departments",
      "genders",
      "admission_types",
      "funding_types",
      "nationalities",
    ]),
  ]);
  const figure = (value: number) => format.number(value);
  const percent = (ratio: number) =>
    format.number(ratio, { style: "percent", maximumFractionDigits: 0 });
  const decimal = (value: number | null, digits = 1) =>
    value === null
      ? "—"
      : format.number(value, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const worded = (set: string) => (value: string) =>
    value === ""
      ? t("noneRecorded")
      : (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value);
  const completeness =
    report.enrolled === 0 ? 0 : Math.round((report.completeness.complete / report.enrolled) * 100);
  const gpaLabels: Record<string, string> = {
    under10: t("students.gpaUnder10"),
    "10to14": t("students.gpa10to14"),
    "14to17": t("students.gpa14to17"),
    "17plus": t("students.gpa17plus"),
    missing: t("students.gpaMissing"),
  };
  const gaps = [
    { key: "unsupervised", count: report.attention.unsupervised },
    { key: "unadvised", count: report.attention.unadvised },
    { key: "noField", count: report.attention.noField },
    { key: "noDegree", count: report.attention.noDegree },
    { key: "noDecision", count: report.attention.noDecision },
    { key: "oldUntouched", count: report.attention.oldUntouched },
    { key: "noAdmissionDate", count: report.attention.noAdmissionDate },
  ];
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

  return (
    <ReportPage
      title={t("students.title")}
      description={t("students.description")}
      back="/students"
      backLabel={t("students.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[{ label: students("title"), href: "/students" }, { label: t("action") }]}
      printLabel={t("print")}
    >
      <section
        aria-label={t("students.overview")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label={t("students.total")}
          value={figure(report.total)}
          hint={t("students.totalHint")}
          icon={Users}
        />
        <StatCard
          label={t("students.enrolled")}
          value={figure(report.enrolled)}
          hint={t("students.enrolledHint")}
          icon={GraduationCap}
        />
        <StatCard
          label={t("students.completeness")}
          value={percent(completeness / 100)}
          hint={t("students.completenessHint")}
        />
        <StatCard
          label={t("students.needsAction")}
          value={figure(report.attention.uniqueStudents)}
          hint={t("students.needsActionHint")}
          icon={CircleAlert}
        />
      </section>

      <ReportBand
        title={t("students.populationTitle")}
        description={t("students.populationHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            categorical(
              "status",
              t("students.byStatus"),
              t("students.statusHint"),
              report.byStatus,
              "student_statuses",
            ),
            categorical(
              "degree",
              t("students.byDegree"),
              t("students.enrolledOnly"),
              report.byDegree,
              "degrees",
            ),
            categorical(
              "faculty",
              t("students.byFaculty"),
              t("students.byDepartmentHint"),
              report.byFaculty,
              "faculties",
            ),
            categorical(
              "field",
              t("students.byField"),
              t("students.byFieldHint"),
              report.byField,
              "fields_of_study",
            ),
            categorical(
              "gender",
              t("students.byGender"),
              t("students.demographicHint"),
              report.byGender,
              "genders",
            ),
            categorical(
              "department",
              t("students.byDepartment"),
              t("students.byDepartmentHint"),
              report.byDepartment,
              "departments",
            ),
          ]}
        />
      </ReportBand>

      <ReportBand
        title={t("students.trendsTitle")}
        description={t("students.trendsHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            {
              id: "admissions",
              type: "trend",
              title: t("students.admissions"),
              description: t("students.admissionsCaption"),
              points: report.admissions,
              yearLabels: Object.fromEntries(
                report.admissions.map((point) => [
                  String(point.year),
                  toLocaleDigits(String(point.year), locale),
                ]),
              ),
              empty: t("noneRecorded"),
              countLabel: t("students.admissions"),
            },
            {
              id: "cohort",
              type: "cohort",
              title: t("students.cohort"),
              description: t("students.cohortHint"),
              rows: report.cohortByStatus,
              yearLabels: Object.fromEntries(
                report.admissions.map((point) => [
                  String(point.year),
                  toLocaleDigits(String(point.year), locale),
                ]),
              ),
              statusLabels: Object.fromEntries(
                report.byStatus.map((row) => [row.value, worded("student_statuses")(row.value)]),
              ),
              empty: t("noneRecorded"),
            },
            categorical(
              "file-stage",
              t("students.fileStage"),
              t("students.fileStageHint"),
              report.stageDistribution,
              undefined,
              {
                registered: t("students.stageRegistered"),
                supervisor_assigned: t("students.stageSupervisorAssigned"),
                supervisor_selection: t("students.stageSupervisorSelection"),
                proposal: t("students.stageProposal"),
                final_defense: t("students.stageFinalDefense"),
                graduated: t("students.stageGraduated"),
              },
            ),
            categorical(
              "admission-type",
              t("students.byAdmissionType"),
              t("students.admissionTypeHint"),
              report.byAdmissionType,
              "admission_types",
            ),
            categorical(
              "funding",
              t("students.byFundingType"),
              t("students.admissionTypeHint"),
              report.byFundingType,
              "funding_types",
            ),
            categorical(
              "nationality",
              t("students.byNationality"),
              t("students.demographicHint"),
              report.byNationality,
              "nationalities",
            ),
          ]}
        />
        <PanelCard
          title={t("students.stageTransitTitle")}
          description={t("students.stageTransitHint")}
        >
          {report.stageTransit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noneRecorded")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {report.stageTransit.map((transition) => (
                <div
                  key={transition.value}
                  className="rounded-xl border border-border/70 bg-muted/15 p-3"
                >
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(`students.stageTransit.${transition.value}`)}
                  </p>
                  <p className="numeric mt-2 text-2xl font-bold tabular-nums">
                    {decimal(transition.averageDays, 1)}
                    <span className="mr-1 text-xs font-normal text-muted-foreground">
                      {t("students.days")}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("students.observations", { count: figure(transition.sampleSize) })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </ReportBand>

      <ReportBand
        title={t("students.progressTitle")}
        description={t("students.progressHint")}
        columns={1}
      >
        <StudentAnalyticsEngine
          columns={3}
          blocks={[
            {
              id: "gpa",
              type: "distribution",
              title: t("students.gpaDistribution"),
              description: t("students.gpaHint"),
              rows: report.gpaDistribution,
              labels: gpaLabels,
              empty: t("noneRecorded"),
            },
            {
              id: "units",
              type: "distribution",
              title: t("students.unitsDistribution"),
              description: t("students.unitsHint"),
              rows: report.unitDistribution,
              labels: {
                missing: t("students.gpaMissing"),
                under20: t("students.unitsUnder20"),
                "20to50": t("students.units20to50"),
                "50to100": t("students.units50to100"),
                "100plus": t("students.units100plus"),
              },
              empty: t("noneRecorded"),
            },
          ]}
        />
        <PanelCard title={t("students.progressMetrics")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label={t("students.averageGpa")}
              value={decimal(report.progress.averageGpa, 2)}
            />
            <Metric
              label={t("students.averageUnits")}
              value={decimal(report.progress.averageUnits)}
            />
            <Metric
              label={t("students.averageSemesters")}
              value={decimal(report.progress.averageSemesters)}
            />
          </div>
        </PanelCard>
      </ReportBand>

      <ReportBand title={t("students.qualityTitle")} description={t("students.qualityHint")}>
        <CompletenessCard
          complete={report.completeness.complete}
          incomplete={report.completeness.incomplete}
          total={report.enrolled}
          figure={figure}
          percent={percent}
          title={t("students.completeness")}
          hint={t("students.completenessRule")}
          completeLabel={t("students.complete")}
          incompleteLabel={t("students.incomplete")}
        />
        <PanelCard title={t("attention")} description={t("students.attentionHint")}>
          <ul className="flex flex-col divide-y">
            {gaps.map((gap) => (
              <li key={gap.key} className="flex items-start justify-between gap-3 py-2.5">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{t(`students.${gap.key}`)}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {t(`students.${gap.key}Hint`)}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
