import { randomUUID } from "node:crypto";
import { ArrowRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { requestPlatformOperationControl } from "@/modules/platform/actions";
import { readPlatformOperationPage } from "@/modules/platform/queries";

export const dynamic = "force-dynamic";

function parseDateBoundary(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export default async function PlatformOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    kind?: string;
    q?: string;
    operator?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requirePlatformConsoleOperator();
  const [params, t, locale] = await Promise.all([
    searchParams,
    getTranslations("platform"),
    getLocale(),
  ]);
  const query = params.q?.trim().toLowerCase() ?? "";
  const allowed = new Set(["queued", "running", "completed", "failed", "cancelled"]);
  const status = allowed.has(params.status ?? "") ? params.status : undefined;
  const kinds = [
    "tenant.create",
    "tenant.rename",
    "tenant.suspend",
    "tenant.resume",
    "tenant.archive",
    "tenant.failed.purge",
    "tenant.owner.set",
    "tenant.user.create",
    "tenant.user.password.reset",
    "backup.create",
    "backup.verify",
    "break-glass.start",
    "break-glass.end",
    "platform.operation.retry",
    "platform.operation.cancel",
  ];
  const kind = kinds.includes(params.kind ?? "") ? params.kind : undefined;
  const operator = params.operator?.trim() || undefined;
  const from = parseDateBoundary(params.from);
  const to = parseDateBoundary(params.to, true);
  const operationLabels: Record<string, string> = {
    "tenant.create": t("operationTenantCreate"),
    "tenant.rename": t("operationTenantRename"),
    "tenant.suspend": t("operationTenantSuspend"),
    "tenant.resume": t("operationTenantResume"),
    "tenant.archive": t("operationTenantArchive"),
    "tenant.failed.purge": t("operationTenantFailedPurge"),
    "tenant.owner.set": t("operationOwnerChange"),
    "tenant.user.create": t("operationUserCreate"),
    "tenant.user.password.reset": t("operationPasswordReset"),
    "backup.create": t("operationBackupCreate"),
    "backup.verify": t("operationBackupVerify"),
    "break-glass.start": t("operationBreakGlassStart"),
    "break-glass.end": t("operationBreakGlassEnd"),
    "platform.operation.retry": t("operationRetry"),
    "platform.operation.cancel": t("operationCancel"),
  };
  const statusLabels: Record<string, string> = {
    queued: t("queued"),
    running: t("running"),
    completed: t("completed"),
    failed: t("failedStatus"),
    cancelled: t("cancelled"),
  };
  const failureLabels: Record<string, string> = {
    authorization_missing: t("operationFailureAuthorization"),
    authorization_revoked: t("operationFailureAuthorization"),
    tenant_not_found: t("operationFailureTenantNotFound"),
    tenant_exists: t("operationFailureTenantExists"),
    target_not_eligible: t("operationFailureTargetNotEligible"),
    account_not_found: t("operationFailureAccountNotFound"),
    tenant_state_conflict: t("operationFailureTenantState"),
    worker_configuration: t("operationFailureConfiguration"),
    invalid_payload: t("operationFailureInvalid"),
    unsupported_operation: t("operationFailureInvalid"),
    worker_interrupted: t("operationFailureInterrupted"),
  };
  const page = Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1);
  const operations = await readPlatformOperationPage({
    query,
    status,
    kind,
    operator,
    from,
    to,
    limit: 24,
    offset: (page - 1) * 24,
  });
  const pages = Math.max(Math.ceil(operations.total / operations.limit), 1);
  const currentPage = Math.min(page, pages);
  const dateFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const makePageUrl = (nextPage: number) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.status) search.set("status", params.status);
    if (params.kind) search.set("kind", params.kind);
    if (params.operator) search.set("operator", params.operator);
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    search.set("page", String(nextPage));
    return `/platform/operations?${search.toString()}`;
  };
  return (
    <main dir={locale === "en" ? "ltr" : "rtl"} className="min-h-svh bg-background">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <Button variant="ghost" nativeButton={false} render={<Link href="/platform" />}>
          <ArrowRight aria-hidden />
          {t("backToPlatform")}
        </Button>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-5 text-primary" aria-hidden />
              {t("operationHistory")}
            </CardTitle>
            <CardDescription>{t("operationsPageDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <form className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_12rem_16rem_minmax(0,1fr)_10rem_10rem_auto]">
              <input
                name="q"
                defaultValue={params.q}
                placeholder={t("operationsSearchPlaceholder")}
                className="h-9 rounded-lg border bg-transparent px-3"
              />
              <select
                name="status"
                defaultValue={params.status ?? ""}
                className="h-9 rounded-lg border bg-background px-3"
              >
                <option value="">{t("allStatuses")}</option>
                <option value="queued">{t("queued")}</option>
                <option value="running">{t("running")}</option>
                <option value="completed">{t("completed")}</option>
                <option value="failed">{t("failedStatus")}</option>
                <option value="cancelled">{t("cancelled")}</option>
              </select>
              <select
                name="kind"
                defaultValue={params.kind ?? ""}
                className="h-9 rounded-lg border bg-background px-3"
              >
                <option value="">{t("allOperationKinds")}</option>
                {kinds.map((value) => (
                  <option key={value} value={value}>
                    {operationLabels[value] ?? value}
                  </option>
                ))}
              </select>
              <input
                name="operator"
                defaultValue={params.operator}
                placeholder={t("operationOperatorPlaceholder")}
                className="h-9 rounded-lg border bg-transparent px-3"
              />
              <label className="flex items-center gap-2 rounded-lg border px-3 text-xs text-muted-foreground">
                <span className="shrink-0">{t("operationFrom")}</span>
                <input
                  name="from"
                  type="date"
                  defaultValue={params.from}
                  className="h-8 min-w-0 flex-1 bg-transparent text-foreground"
                />
              </label>
              <label className="flex items-center gap-2 rounded-lg border px-3 text-xs text-muted-foreground">
                <span className="shrink-0">{t("operationTo")}</span>
                <input
                  name="to"
                  type="date"
                  defaultValue={params.to}
                  className="h-8 min-w-0 flex-1 bg-transparent text-foreground"
                />
              </label>
              <Button type="submit" variant="outline">
                {t("filter")}
              </Button>
            </form>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("operationsResultCount", { count: operations.total })}</span>
              <span>{t("auditPage", { page: currentPage, pages })}</span>
            </div>
            {operations.items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("noOperations")}</p>
            ) : (
              <Table className="table-auto min-w-[900px] text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("operation")}</TableHead>
                    <TableHead>{t("target")}</TableHead>
                    <TableHead>{t("auditOperator")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("createdAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {operationLabels[item.kind] ?? item.kind}
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {item.id}
                        </div>
                      </TableCell>
                      <TableCell>
                        {[item.targetName, item.targetUsername, item.targetSlug]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                      <TableCell>
                        <div>{item.requesterName ?? t("unknownOperator")}</div>
                        {item.requesterUsername ? (
                          <div className="text-xs text-muted-foreground" dir="ltr">
                            {item.requesterUsername}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.status === "completed"
                              ? "secondary"
                              : item.status === "failed"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {statusLabels[item.status] ?? item.status}
                        </Badge>
                        {item.errorCode && (
                          <div className="mt-1 text-xs text-destructive">
                            {failureLabels[item.errorCode] ?? item.errorCode}
                          </div>
                        )}
                        {item.failureDetail && (
                          <div className="mt-1 break-words text-xs text-muted-foreground" dir="ltr">
                            {item.failureDetail}
                          </div>
                        )}
                        {item.errorCode === "operation_failed" && !item.failureDetail ? (
                          <div className="mt-1 text-xs text-destructive">
                            {t("operationFailureLegacy")}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {dateFormatter.format(item.createdAt)}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.status === "queued" ? (
                            <form action={requestPlatformOperationControl}>
                              <input type="hidden" name="operationId" value={item.id} />
                              <input type="hidden" name="action" value="cancel" />
                              <input type="hidden" name="requestId" value={randomUUID()} />
                              <Button type="submit" variant="outline" size="xs">
                                {t("cancelOperation")}
                              </Button>
                            </form>
                          ) : null}
                          {item.status === "failed" &&
                          [
                            "tenant.rename",
                            "tenant.suspend",
                            "tenant.resume",
                            "tenant.archive",
                            "tenant.owner.set",
                            "backup.create",
                            "backup.verify",
                          ].includes(item.kind) ? (
                            <form action={requestPlatformOperationControl}>
                              <input type="hidden" name="operationId" value={item.id} />
                              <input type="hidden" name="action" value="retry" />
                              <input type="hidden" name="requestId" value={randomUUID()} />
                              <Button type="submit" variant="outline" size="xs">
                                {t("retryOperation")}
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <TablePagination className="rounded-t-none border-x-0 border-b-0 shadow-none">
              {currentPage > 1 ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={makePageUrl(currentPage - 1)} />}
                >
                  {t("previous")}
                </Button>
              ) : (
                <span />
              )}
              {currentPage < pages ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={makePageUrl(currentPage + 1)} />}
                >
                  {t("next")}
                </Button>
              ) : (
                <span />
              )}
            </TablePagination>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
