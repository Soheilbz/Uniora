import { Download, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ExportJobsRefresh } from "@/components/settings/export-jobs-refresh";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireCapability } from "@/lib/viewer.ts";
import { isActiveExportJobStatus, readOwnExportJobs } from "@/modules/settings/export-jobs.ts";
import { queueTenantPortabilityExport } from "./actions.ts";

/** Tenant-scoped exports only. Platform backups are operational jobs and are
 * intentionally not exposed to university users or to the web runtime. */
export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("nav.data") };
}

export default async function DataPage() {
  const viewer = await requireCapability("data.export");
  const [t, format, jobs] = await Promise.all([
    getTranslations("settings"),
    getFormatter(),
    readOwnExportJobs(viewer.tenantId, viewer.userId),
  ]);

  const activeJobs = jobs.some((job) => isActiveExportJobStatus(job.status));

  return (
    <div className="flex flex-col gap-6">
      <ExportJobsRefresh active={activeJobs} />
      <SettingsCard title={t("data.exportTitle")} description={t("data.exportSubtitle")}>
        <SettingRow
          label={t("data.exportStudents")}
          hint={t("data.exportSensitive")}
          control={
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href="/students/export" prefetch={false}>
                  <Download className="size-4" aria-hidden />
                  {t("data.exportTitle")}
                </Link>
              }
            />
          }
        />

        {viewer.isTenantOwner ? (
          <SettingRow
            label={t("data.exportTenant")}
            hint={t("data.exportTenantHint")}
            control={
              <form action={queueTenantPortabilityExport}>
                <PendingSubmitButton variant="outline" pendingChildren={t("data.processing")}>
                  <Download className="size-4" aria-hidden />
                  {t("data.exportTenantAction")}
                </PendingSubmitButton>
              </form>
            }
          />
        ) : null}
      </SettingsCard>

      <SettingsCard title={t("data.jobsTitle")} description={t("data.jobsHint")}>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("data.jobsEmpty")}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t(`data.jobKind.${job.kind}`)}</span>
                    <Badge
                      variant={
                        job.status === "completed"
                          ? "secondary"
                          : job.status === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {t(`data.jobStatus.${job.status}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {format.dateTime(job.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    {job.rowCount !== null
                      ? ` · ${t("data.rows", { count: format.number(job.rowCount) })}`
                      : ""}
                  </p>
                  {job.artifactMetadataInvalid ? (
                    <p className="mt-1 max-w-xl text-xs text-destructive">
                      {t("data.exportMetadataInvalid")}
                    </p>
                  ) : job.errorMessage ? (
                    <p className="mt-1 max-w-xl text-xs text-destructive">{job.errorMessage}</p>
                  ) : null}
                </div>
                {job.status === "completed" && job.expiresAt && job.expiresAt > new Date() ? (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link href={`/settings/data/jobs/${job.id}`} prefetch={false}>
                        <Download className="size-4" aria-hidden />
                        {t("data.downloadReady")}
                      </Link>
                    }
                  />
                ) : job.status === "queued" || job.status === "running" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <LoaderCircle className="size-3 animate-spin" aria-hidden />
                    {t("data.processing")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
