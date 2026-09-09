import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlatformOperationalHealth } from "@/modules/platform/operations";

export async function PlatformOperationalAlerts({ health }: { health: PlatformOperationalHealth }) {
  const t = await getTranslations("platform");
  const alerts: Array<{
    label: string;
    detail: string;
    href: string;
    critical?: boolean;
  }> = [];
  const heartbeat = health.jobs.platformWorkerHeartbeatAt;
  const oldestOperationAge = health.jobs.oldestPlatformOperationAgeMinutes;

  if (!heartbeat) {
    alerts.push({
      label: t("workerHeartbeat"),
      detail: t("workerUnavailable"),
      href: "/platform/operations",
      critical: true,
    });
  } else if (Date.now() - heartbeat.getTime() > 90_000) {
    alerts.push({
      label: t("workerHeartbeat"),
      detail: t("workerStale"),
      href: "/platform/operations",
    });
  }
  if ((oldestOperationAge ?? 0) > 5) {
    alerts.push({
      label: t("jobQueue"),
      detail: t("oldestQueuedOperation", { minutes: oldestOperationAge ?? 0 }),
      href: "/platform/operations?status=queued",
    });
  }
  if (health.jobs.staleLeases > 0) {
    alerts.push({
      label: t("jobQueue"),
      detail: t("staleLeases", { count: health.jobs.staleLeases }),
      href: "/platform/operations?status=running",
    });
  }
  if (health.jobs.failed24h > 0) {
    alerts.push({
      label: t("operationHistory"),
      detail: t("failedOperationsAlert", { count: health.jobs.failed24h }),
      href: "/platform/operations?status=failed",
    });
  }
  if (health.backup.ageHours === null || health.backup.ageHours > 24) {
    alerts.push({
      label: t("backupAge"),
      detail: t("backupAttention"),
      href: "/platform/backups",
      critical: health.backup.ageHours === null,
    });
  }
  if (health.storage.status !== "verified") {
    alerts.push({
      label: t("objectStorage"),
      detail:
        health.storage.status === "unconfigured"
          ? t("objectStorageSetupRequired")
          : health.storage.status === "partial"
            ? t("storagePartialHint")
            : t("storageUnreachable"),
      href: "/platform",
      critical: health.storage.status === "unreachable",
    });
  }
  if (!health.database.pgStatStatementsAvailable) {
    alerts.push({
      label: t("queryHealth"),
      detail: t("queryStatsUnavailable"),
      href: "/platform",
    });
  } else if ((health.database.slowQueries ?? 0) > 0) {
    alerts.push({
      label: t("queryHealth"),
      detail: t("querySlowAlert", { count: health.database.slowQueries ?? 0 }),
      href: "/platform",
    });
  }
  if ((health.database.tablesNeedingVacuum ?? 0) > 0) {
    alerts.push({
      label: t("databaseHealth"),
      detail: t("vacuumWarning", { count: health.database.tablesNeedingVacuum ?? 0 }),
      href: "/platform",
    });
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t("operationalAlerts")}</CardTitle>
        <CardDescription>{t("operationalAlertsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {alerts.length === 0 ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            {t("noOperationalAlerts")}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map((alert) => (
              <Link
                key={`${alert.label}-${alert.detail}`}
                href={alert.href}
                className="rounded-xl border bg-muted/10 p-3 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{alert.label}</span>
                  <Badge variant={alert.critical ? "destructive" : "outline"}>
                    {alert.critical ? t("critical") : t("needsAttention")}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{alert.detail}</p>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
