import { AlertTriangle, ClipboardCheck, FileText, Users } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { PeriodStrip, ReportBand, ReportPage } from "@/components/reports/report-page";
import {
  type StudentAnalyticsBlock,
  StudentAnalyticsEngine,
} from "@/components/reports/student-analytics-charts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { parseIntegerParam } from "@/lib/input-limits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { councilBusinessReport, councilBusinessYears } from "@/modules/reports/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("decisions.title") };
}

export default async function DecisionReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[]; register?: string | string[] }>;
}) {
  const viewer = await requireCapability("council.view");
  const params = await searchParams;
  const raw = params.year;
  const rawRegister = params.register;
  const requestedRegister = Array.isArray(rawRegister) ? rawRegister[0] : rawRegister;
  const activeRegister =
    requestedRegister === "rulings" || requestedRegister === "appointments"
      ? requestedRegister
      : "decisions";
  const asked = parseIntegerParam(raw);
  const years = await councilBusinessYears(viewer.tenantId);
  const year = asked !== null && years.includes(asked) ? asked : null;
  const [report, t, nav, format, locale, lookups] = await Promise.all([
    councilBusinessReport(viewer.tenantId, year),
    getTranslations("reports"),
    getTranslations("nav"),
    getFormatter(),
    getLocale(),
    lookupTable(viewer.tenantId, [
      "decision_report_categories",
      "ruling_report_categories",
      "council_review_statuses",
      "degrees",
      "fields_of_study",
      "research_types",
    ]),
  ]);
  const figure = (value: number) => format.number(value);
  const digits = (value: string) => toLocaleDigits(value, locale);
  const labelFor = (set: string) => (value: string) =>
    value === ""
      ? t("noneRecorded")
      : (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value);
  const categorical = (
    id: string,
    title: string,
    description: string,
    rows: { value: string; count: number }[],
    labels: (value: string) => string,
  ): StudentAnalyticsBlock => ({
    id,
    type: rows.length <= 6 ? "composition" : "distribution",
    title,
    description,
    rows,
    labels: Object.fromEntries(rows.map((row) => [row.value, labels(row.value)])),
    empty: t("noneRecorded"),
  });
  const yearPoints = (rows: { year: number; count: number }[]) => ({
    points: rows,
    yearLabels: Object.fromEntries(rows.map((row) => [String(row.year), digits(String(row.year))])),
  });
  const gapList = (keys: readonly string[], values: Record<string, number>) =>
    keys.map((key) => ({
      key,
      count: values[key] ?? 0,
      label: t(`decisions.${key}`),
      hint: t(`decisions.${key}Hint`),
    }));
  const decisionAttention = gapList(
    ["pending", "noDefenceDate", "noBoard", "noRepresentative"],
    report.decisions.attention,
  );
  const rulingAttention = gapList(["pending", "noText", "noCategory"], report.rulings.attention);
  const appointmentAttention = gapList(
    ["noStudent", "noDegree", "noField", "noPrimary"],
    report.appointments.attention,
  );

  return (
    <ReportPage
      title={t("decisions.title")}
      description={t("decisions.description")}
      back="/council-decisions"
      backLabel={t("decisions.back")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[
        { label: nav("councilDecisions"), href: "/council-decisions" },
        { label: t("action") },
      ]}
      printLabel={t("print")}
      period={
        <PeriodStrip
          years={years}
          current={year}
          hrefFor={(value) =>
            value === null
              ? `/council-decisions/reports?register=${activeRegister}`
              : `/council-decisions/reports?register=${activeRegister}&year=${value}`
          }
          allLabel={t("period.all")}
          label={t("period.label")}
          yearLabel={(value) => digits(String(value))}
        />
      }
    >
      <nav
        aria-label={t("decisions.registerReports")}
        className="grid w-full grid-cols-3 gap-1 rounded-xl border border-border/80 bg-muted/40 p-1"
      >
        {(["decisions", "rulings", "appointments"] as const).map((register) => (
          <Link
            key={register}
            href={`/council-decisions/reports?register=${register}${year === null ? "" : `&year=${year}`}`}
            className={`rounded-lg px-3 py-2 text-center text-sm transition-colors ${activeRegister === register ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
            aria-current={activeRegister === register ? "page" : undefined}
          >
            {t(`decisions.${register}`)}
          </Link>
        ))}
      </nav>
      {activeRegister === "decisions" && (
        <ReportBand
          title={t("decisions.decisionsTitle")}
          description={t("decisions.decisionsHint")}
          columns={1}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label={t("decisions.total")}
              value={figure(report.decisions.total)}
              icon={FileText}
            />
            <StatCard
              label={t("decisions.pending")}
              value={figure(report.decisions.attention.pending)}
            />
            <StatCard
              label={t("decisions.noBoard")}
              value={figure(report.decisions.attention.noBoard)}
            />
          </div>
          <StudentAnalyticsEngine
            columns={3}
            blocks={[
              categorical(
                "decision-categories",
                t("decisions.byCategory"),
                t("decisions.byCategoryHint"),
                report.decisions.byCategory,
                labelFor("decision_report_categories"),
              ),
              categorical(
                "decision-degrees",
                t("decisions.byDegree"),
                t("decisions.byDegreeHint"),
                report.decisions.byDegree,
                labelFor("degrees"),
              ),
              categorical(
                "decision-fields",
                t("decisions.byField"),
                t("decisions.byFieldHint"),
                report.decisions.byField,
                labelFor("fields_of_study"),
              ),
              categorical(
                "decision-research",
                t("decisions.byResearchType"),
                t("decisions.byResearchTypeHint"),
                report.decisions.byResearchType,
                labelFor("research_types"),
              ),
              {
                id: "decision-trend",
                type: "trend",
                title: t("decisions.byYear"),
                description: t("decisions.byYearCaption"),
                ...yearPoints(report.decisions.byYear),
                countLabel: t("decisions.total"),
                empty: t("noneRecorded"),
              },
            ]}
          />
          <AttentionPanel
            title={t("decisions.qualityTitle")}
            rows={decisionAttention}
            figure={figure}
          />
        </ReportBand>
      )}
      {activeRegister === "rulings" && (
        <ReportBand
          title={t("decisions.rulingsTitle")}
          description={t("decisions.rulingsHint")}
          columns={1}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label={t("decisions.rulingsTotal")}
              value={figure(report.rulings.total)}
              icon={ClipboardCheck}
            />
            <StatCard
              label={t("decisions.pending")}
              value={figure(report.rulings.attention.pending)}
            />
            <StatCard
              label={t("decisions.noText")}
              value={figure(report.rulings.attention.noText)}
            />
          </div>
          <StudentAnalyticsEngine
            columns={3}
            blocks={[
              categorical(
                "ruling-categories",
                t("decisions.rulingCategories"),
                t("decisions.rulingCategoriesHint"),
                report.rulings.byCategory,
                labelFor("ruling_report_categories"),
              ),
              categorical(
                "ruling-status",
                t("decisions.rulingStatus"),
                t("decisions.rulingStatusHint"),
                report.rulings.byStatus,
                labelFor("council_review_statuses"),
              ),
              {
                id: "ruling-trend",
                type: "trend",
                title: t("decisions.rulingsByYear"),
                description: t("decisions.byYearCaption"),
                ...yearPoints(report.rulings.byYear),
                countLabel: t("decisions.rulingsTotal"),
                empty: t("noneRecorded"),
              },
            ]}
          />
          <AttentionPanel
            title={t("decisions.qualityTitle")}
            rows={rulingAttention}
            figure={figure}
          />
        </ReportBand>
      )}
      {activeRegister === "appointments" && (
        <ReportBand
          title={t("decisions.appointmentsTitle")}
          description={t("decisions.appointmentsHint")}
          columns={1}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label={t("decisions.appointmentsTotal")}
              value={figure(report.appointments.total)}
              icon={Users}
            />
            <StatCard
              label={t("decisions.uniqueStudents")}
              value={figure(report.appointments.distinctStudents)}
              hint={t("decisions.uniqueStudentsHint")}
            />
            <StatCard
              label={t("decisions.noPrimary")}
              value={figure(report.appointments.attention.noPrimary)}
            />
          </div>
          <StudentAnalyticsEngine
            columns={3}
            blocks={[
              categorical(
                "appointment-degrees",
                t("decisions.appointmentDegrees"),
                t("decisions.byDegreeHint"),
                report.appointments.byDegree,
                labelFor("degrees"),
              ),
              categorical(
                "appointment-fields",
                t("decisions.appointmentFields"),
                t("decisions.byFieldHint"),
                report.appointments.byField,
                labelFor("fields_of_study"),
              ),
              {
                id: "appointment-trend",
                type: "trend",
                title: t("decisions.appointmentsByYear"),
                description: t("decisions.byYearCaption"),
                ...yearPoints(report.appointments.byYear),
                countLabel: t("decisions.appointmentsTotal"),
                empty: t("noneRecorded"),
              },
            ]}
          />
          <AttentionPanel
            title={t("decisions.qualityTitle")}
            rows={appointmentAttention}
            figure={figure}
          />
        </ReportBand>
      )}
    </ReportPage>
  );
}

function AttentionPanel({
  title,
  rows,
  figure,
}: {
  title: string;
  rows: { key: string; count: number; label: string; hint: string }[];
  figure: (value: number) => string;
}) {
  return (
    <PanelCard title={title}>
      <ul className="grid gap-x-6 divide-y sm:grid-cols-2 lg:grid-cols-4 sm:divide-y-0">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex min-w-0 items-start justify-between gap-3 border-border/70 py-3"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                {row.label}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{row.hint}</span>
            </span>
            <span className="numeric shrink-0 text-lg font-semibold tabular-nums">
              {figure(row.count)}
            </span>
          </li>
        ))}
      </ul>
    </PanelCard>
  );
}
