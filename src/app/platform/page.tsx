import { CircleAlert, LogOut, RefreshCw, ServerCog, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/app/actions/session";
import { PlatformAdministrationSection } from "@/components/platform/dashboard/administration";
import { PlatformDashboardOverview } from "@/components/platform/dashboard/overview";
import { PlatformRecoverySection } from "@/components/platform/dashboard/recovery";
import { PlatformTenantRegistry } from "@/components/platform/tenant-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePlatformConsoleOperator } from "@/lib/platform-viewer.ts";
import { readPlatformOperationalHealth } from "@/modules/platform/operations";
import {
  readPlatformOperationMetrics,
  readPlatformOperationRequests,
  readPlatformTenantSummaries,
} from "@/modules/platform/queries";

export const dynamic = "force-dynamic";

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ queued?: string; error?: string }>;
}) {
  const operator = await requirePlatformConsoleOperator();
  const [tenants, operations, operationMetrics, operationalHealth, t, locale, params] =
    await Promise.all([
      readPlatformTenantSummaries(),
      readPlatformOperationRequests({ limit: 3 }),
      readPlatformOperationMetrics(),
      readPlatformOperationalHealth(),
      getTranslations("platform"),
      getLocale(),
      searchParams,
    ]);
  const isEnglish = locale === "en";
  const errorMessage =
    params.error === "tenantNotFound"
      ? t("tenantNotFound")
      : params.error === "tenantNotReady"
        ? t("tenantNotReady")
        : params.error === "ownerTargetNotEligible"
          ? t("ownerTargetNotEligible")
          : params.error === "invalidReason"
            ? t("invalidReason")
            : params.error === "confirmationRequired"
              ? t("confirmationRequired")
              : t("operationError");
  return (
    <main dir={isEnglish ? "ltr" : "rtl"} className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  {t("dashboardTitle")}
                </h1>
                <Badge variant="secondary">{t("operatorBadge")}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t("dashboardSubtitle")}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {operator.name} · <span dir="ltr">{operator.username}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href="/platform" />}>
              <RefreshCw aria-hidden />
              {t("refresh")}
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/platform/break-glass" />}
            >
              <ShieldAlert aria-hidden />
              {t("breakGlass")}
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/platform/diagnostics" />}
            >
              <ServerCog aria-hidden />
              {t("diagnosticsTitle")}
            </Button>
            <form action={signOut}>
              <Button type="submit" variant="outline">
                <LogOut aria-hidden />
                {t("signOut")}
              </Button>
            </form>
          </div>
        </header>

        {params.queued ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            {t("queuedNotice")}
          </div>
        ) : null}
        {params.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}
        <PlatformDashboardOverview
          tenants={tenants}
          operationMetrics={operationMetrics}
          operationalHealth={operationalHealth}
        />

        <PlatformRecoverySection operationalHealth={operationalHealth} />
        <PlatformAdministrationSection operations={operations} />
        <PlatformTenantRegistry tenants={tenants} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-2">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            {t("securityNote")}
          </p>
          <Link
            href="/sign-in"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("backToUniversitySignIn")}
          </Link>
        </div>
      </div>
    </main>
  );
}
