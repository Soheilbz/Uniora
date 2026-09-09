import { getFormatter, getTranslations } from "next-intl/server";
import { ScheduledJobManager } from "@/components/engine/scheduled-job-manager.tsx";
import { can } from "@/lib/capabilities.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { listScheduledJobs, SCHEDULABLE_JOB_KINDS } from "@/modules/settings/scheduled-jobs.ts";

export async function generateMetadata() {
  const t = await getTranslations("scheduledJobsSettings");
  return { title: t("title") };
}
export default async function ScheduledJobsPage() {
  const viewer = await requireCapability("reports.schedule");
  const [t, format, jobs] = await Promise.all([
    getTranslations("scheduledJobsSettings"),
    getFormatter(),
    listScheduledJobs(viewer.tenantId),
  ]);
  const visibleKinds = SCHEDULABLE_JOB_KINDS.filter((kind) => {
    if (kind === "export.students") return can(viewer, "data.export", "students.view");
    if (kind === "export.professors") return can(viewer, "data.export", "professors.view");
    if (kind === "export.council-decisions") return can(viewer, "data.export", "council.view");
    if (kind === "export.workshops") return can(viewer, "data.export", "workshops.view");
    if (kind === "export.capacity") return can(viewer, "data.export", "capacity.view");
    if (kind === "export.audit") return can(viewer, "data.export", "audit.view");
    if (kind === "quality.scan") return can(viewer, "data.quality.manage");
    return true;
  });
  const dt = (value: Date | null) =>
    value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ScheduledJobManager
        defaultTimezone={viewer.tenantTimezone}
        jobOptions={visibleKinds.map((value) => ({
          value,
          label: t(`kinds.${value.replaceAll(".", "_")}`),
        }))}
        jobs={jobs.map((job) => ({
          ...job,
          enabled: job.enabled,
          nextRunAt: dt(job.nextRunAt),
          lastRunAt: dt(job.lastRunAt),
        }))}
        words={{
          newTitle: t("newTitle"),
          name: t("name"),
          kind: t("kind"),
          recurrence: t("recurrence"),
          interval: t("interval"),
          daily: t("daily"),
          weekly: t("weekly"),
          everyMinutes: t("everyMinutes"),
          at: t("at"),
          weekdays: t("weekdays"),
          timezone: t("timezone"),
          reminderTitle: t("reminderTitle"),
          reminderBody: t("reminderBody"),
          reminderHref: t("reminderHref"),
          create: t("create"),
          active: t("active"),
          paused: t("paused"),
          pause: t("pause"),
          resume: t("resume"),
          retire: t("retire"),
          nextRun: t("nextRun"),
          lastRun: t("lastRun"),
          never: t("never"),
          empty: t("empty"),
          invalid: t("errors.invalid"),
          stale: t("errors.stale"),
          failed: t("errors.failed"),
          weekdayLabels: [
            t("weekdaysShort.1"),
            t("weekdaysShort.2"),
            t("weekdaysShort.3"),
            t("weekdaysShort.4"),
            t("weekdaysShort.5"),
            t("weekdaysShort.6"),
            t("weekdaysShort.7"),
          ],
        }}
      />
    </div>
  );
}
