import { randomUUID } from "node:crypto";
import { ArrowRight, Clock3, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createDateFormatter } from "@/lib/locale-format";
import { requirePlatformConsoleOperator } from "@/lib/platform-viewer.ts";
import { requestTenantFailedProvisioningPurge } from "@/modules/platform/actions";
import {
  readPlatformOperationRequests,
  readPlatformTenantSummaries,
} from "@/modules/platform/queries";

export const dynamic = "force-dynamic";

function TenantMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-muted/10 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold numeric">{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function PlatformTenantDetails({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requirePlatformConsoleOperator();
  const [{ slug }, tenants, t, locale] = await Promise.all([
    params,
    readPlatformTenantSummaries(),
    getTranslations("platform"),
    getLocale(),
  ]);
  const tenant = tenants.find((item) => item.slug === slug);
  if (!tenant)
    return (
      <main className="mx-auto max-w-3xl p-6" dir={locale === "en" ? "ltr" : "rtl"}>
        <Card>
          <CardContent className="p-8 text-center">
            <p>{t("noUniversities")}</p>
            <Button nativeButton={false} render={<Link href="/platform" />} className="mt-4">
              {t("backToPlatform")}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  const operations = await readPlatformOperationRequests({ slug: tenant.slug });
  const dateFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
  });
  const dateTimeFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const lastActivity = operations[0]?.updatedAt ?? null;
  const latestFailure = operations.find((operation) => operation.status === "failed") ?? null;
  const lifecycleLabel =
    tenant.status === "archived"
      ? t("archived")
      : tenant.status === "suspended"
        ? t("suspended")
        : tenant.provisioningStatus === "provisioning"
          ? t("provisioning")
          : tenant.provisioningStatus === "failed"
            ? t("failedStatus")
            : t("active");
  return (
    <main dir={locale === "en" ? "ltr" : "rtl"} className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button variant="ghost" nativeButton={false} render={<Link href="/platform" />}>
              <ArrowRight aria-hidden />
              {t("backToPlatform")}
            </Button>
            <h1 className="mt-3 text-2xl font-bold">{tenant.name}</h1>
            <p className="text-sm text-muted-foreground" dir="ltr">
              {tenant.slug}
            </p>
          </div>
          <Badge variant={tenant.status === "active" ? "secondary" : "outline"}>
            {lifecycleLabel}
          </Badge>
        </div>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{t("manager")}</p>
              <p className="mt-2 font-semibold">{tenant.manager?.name ?? t("notAvailable")}</p>
              <p className="text-xs text-muted-foreground" dir="ltr">
                {tenant.manager?.username ?? "—"}
              </p>
              {tenant.manager ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant={tenant.manager.mfaEnabled ? "secondary" : "outline"}>
                    {tenant.manager.mfaEnabled ? t("mfaEnabledShort") : t("mfaDisabledShort")}
                  </Badge>
                  {tenant.manager.mustChangePassword ? (
                    <Badge variant="outline">{t("mustChangePassword")}</Badge>
                  ) : null}
                  {tenant.manager.suspendedAt ? (
                    <Badge variant="destructive">{t("suspended")}</Badge>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{t("accounts")}</p>
              <p className="mt-2 text-2xl font-bold numeric">{tenant.accountCount}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{t("createdAt")}</p>
              <p className="mt-2 font-semibold">{dateFormatter.format(tenant.createdAt)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{t("provisioningStatus")}</p>
              <p className="mt-2 font-semibold">{tenant.provisioningStatus}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{t("lastActivity")}</p>
              <p className="mt-2 font-semibold">
                {lastActivity ? dateTimeFormatter.format(lastActivity) : t("noActivity")}
              </p>
            </CardContent>
          </Card>
        </section>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t("tenantUsage")}</CardTitle>
            <CardDescription>{t("tenantUsageDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <TenantMetric label={t("activeUsers")} value={tenant.metrics.activeUsers} />
            <TenantMetric label={t("suspendedUsers")} value={tenant.metrics.suspendedUsers} />
            <TenantMetric label={t("studentRecords")} value={tenant.metrics.students} />
            <TenantMetric label={t("professorRecords")} value={tenant.metrics.professors} />
            <TenantMetric label={t("meetingRecords")} value={tenant.metrics.meetings} />
            <TenantMetric label={t("decisionRecords")} value={tenant.metrics.decisions} />
            <TenantMetric label={t("attachmentObjects")} value={tenant.metrics.attachments} />
            <TenantMetric
              label={t("attachmentBytes")}
              value={formatBytes(tenant.metrics.attachmentBytes)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t("provisioningDetails")}</CardTitle>
            <CardDescription>{t("provisioningDetailsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
            <TenantMetric label={t("provisioningStatus")} value={lifecycleLabel} />
            <TenantMetric
              label={t("provisioningRequestId")}
              value={tenant.provisioningRequestId ?? "—"}
            />
            <div className="rounded-xl border bg-muted/10 p-3 sm:col-span-2">
              <p className="text-xs text-muted-foreground">{t("provisioningLatestFailure")}</p>
              {latestFailure ? (
                <>
                  <p className="mt-1 font-medium text-destructive">
                    {latestFailure.errorCode ?? t("failedStatus")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {latestFailure.failureDetail ?? t("operationFailureLegacy")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
                    {latestFailure.id}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t("noProvisioningFailure")}</p>
              )}
            </div>
            {tenant.provisioningStatus === "failed" && tenant.status === "suspended" ? (
              <form
                action={requestTenantFailedProvisioningPurge}
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 sm:col-span-2"
              >
                <input type="hidden" name="requestId" value={randomUUID()} />
                <input type="hidden" name="slug" value={tenant.slug} />
                <p className="text-sm font-medium">{t("failedProvisioningRecovery")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("failedProvisioningRecoveryDescription")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    name="confirmation"
                    required
                    dir="ltr"
                    placeholder={`PURGE:${tenant.slug}`}
                    aria-label={t("failedProvisioningConfirmation")}
                    className="h-9 min-w-56 flex-1 rounded-lg border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <PendingSubmitButton
                    variant="destructive"
                    pendingChildren={t("submittingOperation")}
                  >
                    {t("purgeFailedProvisioning")}
                  </PendingSubmitButton>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-primary" aria-hidden />
                {t("universityAccounts")}
              </CardTitle>
              <CardDescription>{t("securityNote")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              {tenant.accounts.map((account) => (
                <div
                  key={account.username}
                  className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {account.username}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>
                        {account.lastLoginAt
                          ? `${t("accountLastLogin")}: ${dateTimeFormatter.format(account.lastLoginAt)}`
                          : t("accountNoLogin")}
                      </span>
                      {account.accountExpiresAt ? (
                        <span>
                          {t("accountExpires")}: {dateFormatter.format(account.accountExpiresAt)}
                        </span>
                      ) : null}
                    </div>
                    {account.suspendedReason ? (
                      <p className="mt-1 text-xs text-destructive">
                        {t("accountSuspendedReason")}: {account.suspendedReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Badge variant={account.suspendedAt ? "destructive" : "secondary"}>
                      {account.suspendedAt ? t("suspended") : t("active")}
                    </Badge>
                    {account.isOwner && <Badge variant="secondary">{t("primaryManager")}</Badge>}
                    <Badge variant="outline">
                      {account.mfaEnabled ? t("mfaEnabledShort") : t("mfaDisabledShort")}
                    </Badge>
                    {account.mustChangePassword && (
                      <Badge variant="outline">{t("mustChangePassword")}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="size-5 text-primary" aria-hidden />
                {t("operationHistory")}
              </CardTitle>
              <CardDescription>{t("queueNote")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              {operations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noOperations")}</p>
              ) : (
                operations.slice(0, 12).map((operation) => (
                  <div
                    key={operation.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                  >
                    <span>{operation.kind}</span>
                    <Badge
                      variant={
                        operation.status === "completed"
                          ? "secondary"
                          : operation.status === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {operation.status}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>
        <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <ShieldCheck className="me-2 inline size-4" aria-hidden />
          {t("tenantDetailNote")}
        </div>
      </div>
    </main>
  );
}
