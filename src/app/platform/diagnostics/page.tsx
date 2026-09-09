import { Activity, ArrowRight, Database, HardDrive, ServerCog, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { createDateFormatter } from "@/lib/locale-format";
import { requirePlatformConsoleOperator } from "@/lib/platform-viewer.ts";
import { cn } from "@/lib/utils";
import { readPlatformOperationalHealth } from "@/modules/platform/operations";
import { readPlatformWorkerHealth } from "@/modules/platform/queries";

export const dynamic = "force-dynamic";

function safeWorkerValue(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" && typeof value !== "number") return "—";
  return String(value).slice(0, 160);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function PlatformDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePlatformConsoleOperator("/platform/diagnostics");
  const [health, workers, t, common, locale, params] = await Promise.all([
    readPlatformOperationalHealth(),
    readPlatformWorkerHealth(),
    getTranslations("platform"),
    getTranslations("common"),
    getLocale(),
    searchParams,
  ]);
  const isEnglish = locale === "en";
  const storageCapabilities = health.storage.capabilities ?? {
    put: "not-tested",
    head: "not-tested",
    get: "not-tested",
    delete: "not-tested",
    presignedGet: "not-tested",
    presignedPut: "not-tested",
  };
  const dateFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const pageSize = 15;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const sortedWorkers = [...workers].sort(
    (left, right) =>
      right.observedAt.getTime() - left.observedAt.getTime() || right.key.localeCompare(left.key),
  );
  const pages = Math.max(Math.ceil(sortedWorkers.length / pageSize), 1);
  const currentPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    pages,
  );
  const recentWorkers = sortedWorkers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageHref = (page: number) => `/platform/diagnostics?page=${page}`;
  const now = Date.now();
  return (
    <main dir={isEnglish ? "ltr" : "rtl"} className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" nativeButton={false} render={<Link href="/platform" />}>
            <ArrowRight aria-hidden />
            {t("backToPlatform")}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/platform/operations" />}
            >
              {t("operationHistory")}
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/platform/audit" />}>
              {t("auditExplorer")}
            </Button>
          </div>
        </div>

        <header className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                {t("diagnosticsTitle")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("diagnosticsDescription")}</p>
            </div>
          </div>
        </header>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5 text-primary" aria-hidden />
              {t("workerRegistry")}
            </CardTitle>
            <CardDescription>
              {t("workerRegistryDescription")} {t("workerRegistryLatest")}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {workers.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                {t("noWorkerHeartbeat")}
              </p>
            ) : (
              <div className="min-w-0">
                <Table className="table-auto min-w-[900px] text-sm">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t("workerName")}</TableHead>
                      <TableHead>{t("workerStatus")}</TableHead>
                      <TableHead>{t("workerInstance")}</TableHead>
                      <TableHead>{t("workerProcess")}</TableHead>
                      <TableHead>{t("workerObservedAt")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentWorkers.map((worker) => {
                      const stale = now - worker.observedAt.getTime() > 90_000;
                      return (
                        <TableRow key={worker.key}>
                          <TableCell className="font-medium" dir="ltr">
                            {worker.key}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                worker.status === "ok" && !stale ? "secondary" : "destructive"
                              }
                            >
                              {stale
                                ? t("workerStale")
                                : worker.status === "ok"
                                  ? t("healthy")
                                  : worker.status}
                            </Badge>
                          </TableCell>
                          <TableCell dir="ltr">
                            {safeWorkerValue(worker.payload, "instanceId")}
                          </TableCell>
                          <TableCell dir="ltr">{safeWorkerValue(worker.payload, "pid")}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {dateFormatter.format(worker.observedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <TablePagination className="justify-center rounded-none border-x-0 border-b-0 shadow-none">
                  <nav
                    aria-label={common("page", { page: currentPage, pages })}
                    className="flex w-full flex-wrap items-center justify-center gap-1.5"
                  >
                    {currentPage > 1 ? (
                      <Link
                        href={pageHref(currentPage - 1)}
                        rel="prev"
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "px-3")}
                      >
                        {common("previous")}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "pointer-events-none px-3 opacity-50",
                        )}
                      >
                        {common("previous")}
                      </span>
                    )}
                    {Array.from({ length: pages }, (_, index) => index + 1).map((page) =>
                      page === currentPage ? (
                        <span
                          key={page}
                          aria-current="page"
                          className={cn(
                            buttonVariants({ variant: "default", size: "sm" }),
                            "min-w-9 px-2",
                          )}
                        >
                          {common("plainNumber", { value: page })}
                        </span>
                      ) : (
                        <Link
                          key={page}
                          href={pageHref(page)}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "min-w-9 px-2",
                          )}
                        >
                          {common("plainNumber", { value: page })}
                        </Link>
                      ),
                    )}
                    {currentPage < pages ? (
                      <Link
                        href={pageHref(currentPage + 1)}
                        rel="next"
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "px-3")}
                      >
                        {common("next")}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "pointer-events-none px-3 opacity-50",
                        )}
                      >
                        {common("next")}
                      </span>
                    )}
                  </nav>
                </TablePagination>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Database className="size-5 text-primary" aria-hidden />
                {t("databaseDiagnostics")}
              </CardTitle>
              <CardDescription>{t("databaseDiagnosticsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
              <Metric label={t("databaseVersion")} value={health.database.serverVersion ?? "—"} />
              <Metric
                label={t("databaseSize")}
                value={
                  health.database.databaseSizeBytes === null
                    ? "—"
                    : formatBytes(health.database.databaseSizeBytes)
                }
              />
              <Metric
                label={t("databaseHitRatio")}
                value={
                  health.database.indexHitRatioPct === null
                    ? "—"
                    : `${health.database.indexHitRatioPct}%`
                }
              />
              <Metric label={t("deadTuples")} value={String(health.database.deadTuples ?? "—")} />
              <Metric
                label={t("tablesNeedingVacuum")}
                value={String(health.database.tablesNeedingVacuum ?? "—")}
              />
              <Metric
                label={t("longTransactions")}
                value={String(health.database.longTransactions ?? "—")}
              />
              <Metric label={t("migrationMarker")} value={health.database.migrationMarker ?? "—"} />
              <Metric label={t("queryStatsStatus")} value={health.database.queryStatsStatus} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-5 text-primary" aria-hidden />
                {t("resilienceDiagnostics")}
              </CardTitle>
              <CardDescription>{t("resilienceDiagnosticsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
              <Metric
                label={t("lastBackupVerification")}
                value={
                  health.backup.lastVerifiedAt
                    ? dateFormatter.format(health.backup.lastVerifiedAt)
                    : t("neverVerified")
                }
              />
              <Metric label={t("retainedBackups")} value={String(health.backup.retainedCount)} />
              <Metric label={t("backupTotalSize")} value={formatBytes(health.backup.totalBytes)} />
              <Metric
                label={t("oldestBackup")}
                value={
                  health.backup.oldestCreatedAt
                    ? dateFormatter.format(health.backup.oldestCreatedAt)
                    : "—"
                }
              />
              <Metric
                label={t("objectStorage")}
                value={
                  health.storage.status === "verified"
                    ? t("verified")
                    : health.storage.status === "unreachable"
                      ? t("unreachable")
                      : health.storage.status === "partial"
                        ? t("storagePartial")
                        : t("notConfigured")
                }
              />
              <Metric
                label={t("storageCheckedAt")}
                value={
                  health.storage.checkedAt ? dateFormatter.format(health.storage.checkedAt) : "—"
                }
              />
              <div className="rounded-xl border bg-muted/10 p-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground">{t("storageCapabilities")}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {Object.entries(storageCapabilities).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-2 text-xs">
                      <span dir="ltr">{key}</span>
                      <Badge
                        variant={
                          value === "pass"
                            ? "secondary"
                            : value === "fail"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {value === "pass"
                          ? t("capabilityPass")
                          : value === "fail"
                            ? t("capabilityFail")
                            : t("capabilityNotTested")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <Metric
                label={t("workerQueue")}
                value={`${health.jobs.queued + health.jobs.retry}`}
              />
              <Metric label={t("staleLeases", { count: health.jobs.staleLeases })} value="—" />
            </CardContent>
          </Card>
        </section>

        <div className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <ServerCog className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t("diagnosticsSecurityNote")}</p>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/10 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-semibold" dir="auto">
        {value}
      </p>
    </div>
  );
}
