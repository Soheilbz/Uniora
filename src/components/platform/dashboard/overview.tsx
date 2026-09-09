import {
  Activity,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  HardDrive,
  ServerCog,
  Users,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { PlatformOperationalAlerts } from "@/components/platform/operational-alerts";
import { formatBytes, OperationalCard } from "@/components/platform/operational-card";
import { PlatformStatusBreakdown } from "@/components/platform/status-breakdown";
import { Card, CardContent } from "@/components/ui/card";
import { createDateFormatter } from "@/lib/locale-format";
import type { readPlatformOperationalHealth } from "@/modules/platform/operations";
import type {
  readPlatformOperationMetrics,
  readPlatformTenantSummaries,
} from "@/modules/platform/queries";

type Tenants = Awaited<ReturnType<typeof readPlatformTenantSummaries>>;
type Metrics = Awaited<ReturnType<typeof readPlatformOperationMetrics>>;
type Health = Awaited<ReturnType<typeof readPlatformOperationalHealth>>;

export async function PlatformDashboardOverview({
  tenants,
  operationMetrics,
  operationalHealth,
}: {
  tenants: Tenants;
  operationMetrics: Metrics;
  operationalHealth: Health;
}) {
  const [t, locale] = await Promise.all([getTranslations("platform"), getLocale()]);
  const activeCount = tenants.filter(
    (tenant) => tenant.status === "active" && tenant.provisioningStatus === "active",
  ).length;
  const accountCount = tenants.reduce((total, tenant) => total + tenant.accountCount, 0);
  const suspendedTenantCount = tenants.filter((tenant) => tenant.status === "suspended").length;
  const archivedTenantCount = tenants.filter((tenant) => tenant.status === "archived").length;
  const provisioningTenantCount = tenants.filter(
    (tenant) => tenant.provisioningStatus === "provisioning",
  ).length;
  const failedProvisioningCount = tenants.filter(
    (tenant) => tenant.provisioningStatus === "failed",
  ).length;
  const pendingCount = operationMetrics.pending;
  const dateTimeFormatter = createDateFormatter(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <>
      <section aria-label={t("universities")} className="grid gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("universities")}</p>
              <p className="mt-1 text-2xl font-bold numeric">{tenants.length}</p>
            </div>
            <Building2 className="size-5 text-primary" aria-hidden />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("active")}</p>
              <p className="mt-1 text-2xl font-bold numeric">{activeCount}</p>
            </div>
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("accounts")}</p>
              <p className="mt-1 text-2xl font-bold numeric">{accountCount}</p>
            </div>
            <Users className="size-5 text-primary" aria-hidden />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("operationsPending")}</p>
              <p className="mt-1 text-2xl font-bold numeric">{pendingCount}</p>
            </div>
            <CircleAlert className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
          </CardContent>
        </Card>
      </section>
      <PlatformStatusBreakdown
        title={t("platformStatusBreakdown")}
        lifecycleSummary={t("tenantLifecycleSummary")}
        last24Hours={t("last24Hours")}
        labels={{
          suspended: t("suspendedUniversities"),
          provisioning: t("provisioningUniversities"),
          failedProvisioning: t("failedProvisioning"),
          archived: t("archivedUniversities"),
          successful: t("successfulOperations"),
          failed: t("failedOperations"),
        }}
        counts={{
          suspended: suspendedTenantCount,
          provisioning: provisioningTenantCount,
          failedProvisioning: failedProvisioningCount,
          archived: archivedTenantCount,
          successful: operationMetrics.successful24h,
          failed: operationMetrics.failed24h,
        }}
      />
      <section
        aria-label={t("operationalHealth")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <OperationalCard
          label={t("jobQueue")}
          value={String(operationalHealth.jobs.queued + operationalHealth.jobs.retry)}
          detail={`${t("jobQueueDetail", {
            running: operationalHealth.jobs.running,
            failed: operationalHealth.jobs.failed24h,
          })} · ${
            operationalHealth.jobs.oldestPlatformOperationAgeMinutes === null
              ? t("noQueuedOperations")
              : t("oldestQueuedOperation", {
                  minutes: operationalHealth.jobs.oldestPlatformOperationAgeMinutes,
                })
          }`}
          icon={<Activity className="size-4" aria-hidden />}
          alert={
            operationalHealth.jobs.staleLeases > 0 ||
            (operationalHealth.jobs.oldestPlatformOperationAgeMinutes ?? 0) > 5
          }
        />
        <OperationalCard
          label={t("workerHeartbeat")}
          value={
            operationalHealth.jobs.platformWorkerHeartbeatAt
              ? dateTimeFormatter.format(operationalHealth.jobs.platformWorkerHeartbeatAt)
              : t("notAvailable")
          }
          detail={
            operationalHealth.jobs.platformWorkerHeartbeatAt === null
              ? t("workerUnavailable")
              : Date.now() - operationalHealth.jobs.platformWorkerHeartbeatAt.getTime() > 90_000
                ? t("workerStale")
                : operationalHealth.jobs.staleLeases > 0
                  ? t("staleLeases", { count: operationalHealth.jobs.staleLeases })
                  : t("noStaleLeases")
          }
          icon={<Clock3 className="size-4" aria-hidden />}
          alert={
            operationalHealth.jobs.platformWorkerHeartbeatAt === null ||
            Date.now() - operationalHealth.jobs.platformWorkerHeartbeatAt.getTime() > 90_000 ||
            operationalHealth.jobs.staleLeases > 0
          }
        />
        <OperationalCard
          label={t("databaseLatency")}
          value={
            operationalHealth.database.latencyMs === null
              ? t("notAvailable")
              : `${operationalHealth.database.latencyMs} ms`
          }
          detail={
            operationalHealth.database.serverVersion
              ? `PostgreSQL ${operationalHealth.database.serverVersion}`
              : t("databaseStatsUnavailable")
          }
          icon={<Database className="size-4" aria-hidden />}
          alert={
            (operationalHealth.database.longTransactions ?? 0) > 0 ||
            (operationalHealth.database.idleInTransaction ?? 0) > 0
          }
        />
        <OperationalCard
          label={t("databaseConnections")}
          value={
            operationalHealth.database.totalConnections === null
              ? t("notAvailable")
              : String(operationalHealth.database.totalConnections)
          }
          detail={t("databaseConnectionsDetail", {
            active: operationalHealth.database.activeConnections ?? 0,
            long: operationalHealth.database.longTransactions ?? 0,
          })}
          icon={<ServerCog className="size-4" aria-hidden />}
          alert={(operationalHealth.database.longTransactions ?? 0) > 0}
        />
        <OperationalCard
          label={t("backupAge")}
          value={
            operationalHealth.backup.ageHours === null
              ? t("notAvailable")
              : t("hours", { count: operationalHealth.backup.ageHours })
          }
          detail={operationalHealth.backup.manifest ?? t("noBackupManifest")}
          icon={<HardDrive className="size-4" aria-hidden />}
          alert={
            operationalHealth.backup.ageHours === null || operationalHealth.backup.ageHours > 24
          }
        />
        <OperationalCard
          label={t("objectStorage")}
          value={
            operationalHealth.storage.status === "verified"
              ? t("verified")
              : operationalHealth.storage.status === "unreachable"
                ? t("unreachable")
                : operationalHealth.storage.status === "partial"
                  ? t("storagePartial")
                  : t("notConfigured")
          }
          detail={
            operationalHealth.storage.status === "unconfigured"
              ? t("objectStorageSetupRequired")
              : operationalHealth.storage.status === "partial"
                ? t("storagePartialHint")
                : t("objectStorageChecked")
          }
          icon={<HardDrive className="size-4" aria-hidden />}
          alert={operationalHealth.storage.status !== "verified"}
        />
        <OperationalCard
          label={t("connectionUtilization")}
          value={
            operationalHealth.database.connectionUtilizationPct === null
              ? t("notAvailable")
              : `${operationalHealth.database.connectionUtilizationPct}%`
          }
          detail={
            operationalHealth.database.maxConnections === null
              ? t("databaseStatsUnavailable")
              : t("connectionUtilizationDetail", {
                  used: operationalHealth.database.connectionUtilizationPct ?? 0,
                  max: operationalHealth.database.maxConnections,
                })
          }
          icon={<ServerCog className="size-4" aria-hidden />}
          alert={(operationalHealth.database.connectionUtilizationPct ?? 0) >= 80}
        />
        <OperationalCard
          label={t("queryHealth")}
          value={
            operationalHealth.database.pgStatStatementsAvailable
              ? String(operationalHealth.database.slowQueries ?? 0)
              : t(
                  operationalHealth.database.queryStatsStatus === "not-installed"
                    ? "queryStatsNotInstalledShort"
                    : operationalHealth.database.queryStatsStatus === "not-enabled"
                      ? "queryStatsNotEnabledShort"
                      : "notAvailable",
                )
          }
          detail={
            operationalHealth.database.pgStatStatementsAvailable
              ? t("queryHealthDetail", {
                  slow: operationalHealth.database.slowQueries ?? 0,
                  worst: operationalHealth.database.worstMeanQueryMs ?? 0,
                })
              : t(
                  operationalHealth.database.queryStatsStatus === "not-installed"
                    ? "queryStatsNotInstalled"
                    : operationalHealth.database.queryStatsStatus === "not-enabled"
                      ? "queryStatsNotEnabled"
                      : "queryStatsUnavailable",
                )
          }
          icon={<Activity className="size-4" aria-hidden />}
          alert={(operationalHealth.database.slowQueries ?? 0) > 0}
        />
        <OperationalCard
          label={t("storageSize")}
          value={
            operationalHealth.database.databaseSizeBytes === null
              ? t("notAvailable")
              : formatBytes(operationalHealth.database.databaseSizeBytes)
          }
          detail={t("storageSizeDetail", {
            hit: operationalHealth.database.indexHitRatioPct ?? 0,
            dead: operationalHealth.database.deadTuples ?? 0,
          })}
          icon={<Database className="size-4" aria-hidden />}
          alert={(operationalHealth.database.tablesNeedingVacuum ?? 0) > 0}
        />
        <OperationalCard
          label={t("tablesNeedingVacuum")}
          value={String(operationalHealth.database.tablesNeedingVacuum ?? 0)}
          detail={t("deadTuplesDetail", { count: operationalHealth.database.deadTuples ?? 0 })}
          icon={<Activity className="size-4" aria-hidden />}
          alert={(operationalHealth.database.tablesNeedingVacuum ?? 0) > 0}
        />
      </section>

      <PlatformOperationalAlerts health={operationalHealth} />
    </>
  );
}
