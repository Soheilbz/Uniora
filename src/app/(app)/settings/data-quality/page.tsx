import { AlertTriangle, CircleCheck, Database, History, PlayCircle } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { ReportPage } from "@/components/reports/report-page";
import { Button } from "@/components/ui/button.tsx";
import { can } from "@/lib/capabilities.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readDataQuality, readDataQualityHistory } from "@/modules/settings/data-quality.ts";
import { runDataQualityScan } from "@/modules/settings/data-quality-actions.ts";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("dataQuality.title") };
}

export default async function DataQualityPage() {
  const viewer = await requireCapability("data.quality.view");
  const [issues, history, t, nav, format] = await Promise.all([
    readDataQuality(viewer.tenantId),
    readDataQualityHistory(viewer.tenantId),
    getTranslations("settings"),
    getTranslations("nav"),
    getFormatter(),
  ]);
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const total = issues.reduce((sum, issue) => sum + issue.count, 0);
  const label = (key: string) => t(`dataQuality.issues.${key}`);
  const grouped = new Map<string, typeof history>();
  for (const point of history) {
    const list = grouped.get(point.code) ?? [];
    list.push(point);
    grouped.set(point.code, list);
  }
  const trends = [...grouped.entries()]
    .map(([code, points]) => {
      const latest = points[0];
      const previous = points.find(
        (point) => point.capturedAt.getTime() !== latest?.capturedAt.getTime(),
      );
      return latest
        ? { code, latest, previous, delta: previous ? latest.count - previous.count : null }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <ReportPage
      title={t("dataQuality.title")}
      description={t("dataQuality.subtitle")}
      back="/settings/data"
      backLabel={t("nav.data")}
      breadcrumbLabel={nav("breadcrumb")}
      breadcrumbs={[
        { label: nav("settings"), href: "/settings" },
        { label: t("dataQuality.title") },
      ]}
      printLabel={t("dataQuality.print")}
    >
      {can(viewer, "data.quality.manage") ? (
        <div data-print-hide className="flex justify-end">
          <form action={runDataQualityScan}>
            <Button type="submit" variant="outline">
              <PlayCircle className="size-4" aria-hidden />
              {t("dataQuality.capture")}
            </Button>
          </form>
        </div>
      ) : null}
      <section aria-label={t("dataQuality.overview")} className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("dataQuality.totalIssues")}
          value={format.number(total)}
          icon={Database}
        />
        <StatCard
          label={t("dataQuality.errors")}
          value={format.number(errors.reduce((sum, issue) => sum + issue.count, 0))}
          icon={AlertTriangle}
        />
        <StatCard
          label={t("dataQuality.warnings")}
          value={format.number(warnings.reduce((sum, issue) => sum + issue.count, 0))}
          icon={CircleCheck}
        />
      </section>

      <PanelCard title={t("dataQuality.checksTitle")} description={t("dataQuality.checksHint")}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {issues.map((issue) => (
            <li
              key={issue.key}
              className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-muted/10 p-3"
            >
              <span className="flex min-w-0 items-start gap-2">
                <span
                  className={
                    issue.severity === "error"
                      ? "mt-1 size-2 shrink-0 rounded-full bg-destructive"
                      : "mt-1 size-2 shrink-0 rounded-full bg-warning"
                  }
                  aria-hidden
                />
                <span className="text-sm leading-relaxed">{label(issue.key)}</span>
              </span>
              <span className="numeric shrink-0 text-lg font-semibold tabular-nums">
                {format.number(issue.count)}
              </span>
            </li>
          ))}
        </ul>
        {issues.length === 0 || total === 0 ? (
          <p className="mt-4 rounded-xl border border-success/30 bg-success/8 p-3 text-sm text-success-foreground">
            {t("dataQuality.noIssues")}
          </p>
        ) : null}
      </PanelCard>

      <PanelCard title={t("dataQuality.historyTitle")} description={t("dataQuality.historyHint")}>
        {trends.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dataQuality.historyEmpty")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {trends.slice(0, 20).map((trend) => (
              <li
                key={trend.code}
                className="flex items-center justify-between gap-4 rounded-xl border border-border/70 p-3"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm">
                    <History className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{label(trend.code)}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {format.dateTime(trend.latest.capturedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="numeric block font-semibold">
                    {format.number(trend.latest.count)}
                  </span>
                  {trend.delta !== null ? (
                    <span className="numeric text-xs text-muted-foreground">
                      {trend.delta > 0 ? "+" : ""}
                      {format.number(trend.delta)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </ReportPage>
  );
}
