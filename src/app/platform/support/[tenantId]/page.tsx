import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isUuid } from "@/lib/uuid.ts";
import {
  readBreakGlassSupportOverview,
  requireBreakGlassAccess,
} from "@/modules/platform/break-glass.ts";

export const dynamic = "force-dynamic";
export default async function SupportPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isUuid(tenantId)) notFound();
  const { operator, session } = await requireBreakGlassAccess(tenantId);
  const [overview, t, format, locale] = await Promise.all([
    readBreakGlassSupportOverview(tenantId),
    getTranslations("platformSupport"),
    getFormatter(),
    getLocale(),
  ]);
  const direction = locale === "en" ? "ltr" : "rtl";
  const stats = [
    [t("students"), overview.counts.students],
    [t("professors"), overview.counts.professors],
    [t("decisions"), overview.counts.decisions],
    [t("workshops"), overview.counts.workshops],
    [t("openTasks"), overview.counts.openTasks],
  ] as const;
  return (
    <main dir={direction} className="min-h-svh bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-card p-5">
          <div className="flex gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">
                  {overview.institution?.name || t("unknownInstitution")}
                </h1>
                <Badge variant="destructive">{t("breakGlass")}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {overview.institution?.faculty || t("diagnosticOnly")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {operator.username} · {t("expires")}{" "}
                {format.dateTime(session.expiresAt, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/platform/break-glass" />}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("back")}
          </Button>
        </header>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stats.map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold numeric">{value}</p>
              </CardContent>
            </Card>
          ))}
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("failedJobs")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {overview.failedJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("none")}</p>
              ) : (
                overview.failedJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs" dir="ltr">
                        {job.kind}
                      </code>
                      <Badge variant="outline">
                        {t("attempt")} {job.attempt}
                      </Badge>
                    </div>
                    {job.publicError ? (
                      <p className="mt-1 text-sm text-muted-foreground">{job.publicError}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("quality")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {overview.quality.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("none")}</p>
              ) : (
                overview.quality.map((item) => (
                  <div
                    key={`${item.code}-${item.capturedAt.toISOString()}`}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <code className="text-xs" dir="ltr">
                        {item.code}
                      </code>
                      <p className="text-xs text-muted-foreground">
                        {format.dateTime(item.capturedAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                    <Badge variant={item.count > 0 ? "destructive" : "outline"}>{item.count}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("features")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {overview.features.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            ) : (
              overview.features.map((feature) => (
                <Badge key={feature.key} variant={feature.enabled ? "default" : "outline"}>
                  {feature.key}: {feature.enabled ? t("featureEnabled") : t("featureDisabled")}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">{t("diagnosticOnly")}</p>
      </div>
    </main>
  );
}
