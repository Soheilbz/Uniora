import { randomUUID } from "node:crypto";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePlatformConsoleOperator } from "@/lib/platform-viewer.ts";
import { requestBreakGlassEnd, requestBreakGlassStart } from "@/modules/platform/actions.ts";
import { readPlatformBreakGlassSessions } from "@/modules/platform/break-glass.ts";
import { readPlatformTenantSummaries } from "@/modules/platform/queries.ts";

export const dynamic = "force-dynamic";

export default async function BreakGlassPage() {
  const operator = await requirePlatformConsoleOperator("/platform/break-glass");
  const [tenants, active, t, format, locale] = await Promise.all([
    readPlatformTenantSummaries(),
    readPlatformBreakGlassSessions(operator.userId),
    getTranslations("platformBreakGlass"),
    getFormatter(),
    getLocale(),
  ]);
  const direction = locale === "en" ? "ltr" : "rtl";
  const activeTenants = tenants.filter(
    (tenant) => tenant.status !== "archived" && tenant.provisioningStatus === "active",
  );
  return (
    <main dir={direction} className="min-h-svh bg-background text-foreground">
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <ShieldAlert className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-bold">{t("title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>
          <Button variant="outline" nativeButton={false} render={<Link href="/platform" />}>
            <ArrowLeft className="size-4" aria-hidden />
            {t("back")}
          </Button>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>{t("startTitle")}</CardTitle>
            <CardDescription>{t("startDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={requestBreakGlassStart} className="grid gap-4 md:grid-cols-2">
              <input type="hidden" name="requestId" value={randomUUID()} />
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("tenant")}</span>
                <select
                  name="slug"
                  required
                  defaultValue={activeTenants[0]?.slug ?? ""}
                  className="h-9 rounded-lg border bg-background px-3"
                >
                  {activeTenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.slug}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("duration")}</span>
                <select
                  name="durationMinutes"
                  defaultValue="30"
                  className="h-9 rounded-lg border bg-background px-3"
                >
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="15">15</option>
                  <option value="30">30</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm md:col-span-2">
                <span className="font-medium">{t("reason")}</span>
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={4}
                  className="rounded-lg border bg-background px-3 py-2"
                  placeholder={t("reasonPlaceholder")}
                />
              </label>
              <label className="flex items-start gap-2 text-sm md:col-span-2">
                <input type="checkbox" name="notifyTenant" defaultChecked className="mt-1" />
                <span>
                  <strong className="font-medium">{t("notify")}</strong>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t("notifyHint")}
                  </span>
                </span>
              </label>
              <div className="md:col-span-2">
                <PendingSubmitButton
                  disabled={activeTenants.length === 0}
                  pendingChildren={t("starting")}
                >
                  {t("start")}
                </PendingSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("activeTitle")}</CardTitle>
            <CardDescription>{t("activeDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              active.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-xl border p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.tenantName}</p>
                      <Badge variant="destructive">{t("active")}</Badge>
                      {item.tenantNotifiedAt ? (
                        <Badge variant="outline">{t("notified")}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("expires")}:{" "}
                      {format.dateTime(item.expiresAt, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/platform/support/${item.tenantId}`} />}
                    >
                      {t("openSupport")}
                    </Button>
                    <form action={requestBreakGlassEnd}>
                      <input type="hidden" name="requestId" value={randomUUID()} />
                      <input type="hidden" name="breakGlassId" value={item.id} />
                      <input type="hidden" name="slug" value={item.tenantSlug} />
                      <Button type="submit" size="sm" variant="outline">
                        {t("end")}
                      </Button>
                    </form>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
