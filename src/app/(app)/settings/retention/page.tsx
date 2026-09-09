import { AlertTriangle, DatabaseZap, FlaskConical, LockKeyhole } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { requireCapability } from "@/lib/viewer.ts";
import {
  RETENTION_RESOURCE_CATALOG,
  readRetentionPolicies,
  readRetentionRuns,
} from "@/modules/settings/retention.ts";
import {
  runRetentionDryRunAction,
  runRetentionPurgeAction,
  saveRetentionPolicyAction,
} from "@/modules/settings/retention-actions.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("retentionSettings");
  return { title: t("title") };
}

export default async function RetentionSettingsPage() {
  const viewer = await requireCapability("retention.manage");
  const [policies, runs, t, format] = await Promise.all([
    readRetentionPolicies(viewer.tenantId),
    readRetentionRuns(viewer.tenantId),
    getTranslations("retentionSettings"),
    getFormatter(),
  ]);
  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex gap-3 p-4 text-sm">
          <LockKeyhole
            className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden
          />
          <p>{t("protectedNotice")}</p>
        </CardContent>
      </Card>

      <section className="grid gap-3">
        {RETENTION_RESOURCE_CATALOG.map((definition) => {
          const policy = policies.get(definition.key);
          const enabled = policy?.enabled ?? false;
          const hold = policy?.legalHold ?? false;
          return (
            <Card key={definition.key}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {t(`resources.${definition.key}.name`)}
                    </CardTitle>
                    <CardDescription>
                      {t(`resources.${definition.key}.description`)}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {hold ? <Badge variant="destructive">{t("legalHold")}</Badge> : null}
                    <Badge variant={enabled ? "default" : "outline"}>
                      {enabled ? t("enabled") : t("disabled")}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form
                  action={saveRetentionPolicyAction}
                  className="grid gap-3 sm:grid-cols-[minmax(10rem,14rem)_auto_auto_auto] sm:items-end"
                >
                  <input type="hidden" name="resource" value={definition.key} />
                  <input type="hidden" name="expectedVersion" value={policy?.version ?? ""} />
                  <label className="grid gap-1.5 text-sm">
                    <span className="font-medium">{t("retainDays")}</span>
                    <input
                      name="retainDays"
                      type="number"
                      required
                      min={definition.minDays}
                      max={definition.maxDays}
                      defaultValue={policy?.retainDays ?? definition.defaultDays}
                      className="h-9 rounded-lg border bg-background px-3"
                    />
                    <span className="text-xs text-muted-foreground">
                      {t("range", { min: definition.minDays, max: definition.maxDays })}
                    </span>
                  </label>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input type="checkbox" name="enabled" value="true" defaultChecked={enabled} />
                    {t("policyEnabled")}
                  </label>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input type="checkbox" name="legalHold" value="true" defaultChecked={hold} />
                    {t("legalHold")}
                  </label>
                  <Button type="submit" size="sm">
                    {t("save")}
                  </Button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("executionTitle")}</CardTitle>
          <CardDescription>{t("executionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <form action={runRetentionDryRunAction}>
            <PendingSubmitButton variant="outline" pendingChildren={t("queueing")}>
              <FlaskConical className="size-4" aria-hidden />
              {t("dryRun")}
            </PendingSubmitButton>
          </form>
          <form action={runRetentionPurgeAction}>
            <PendingSubmitButton variant="destructive" pendingChildren={t("queueing")}>
              <DatabaseZap className="size-4" aria-hidden />
              {t("purge")}
            </PendingSubmitButton>
          </form>
          <p className="basis-full text-xs text-muted-foreground">
            <AlertTriangle className="me-1 inline size-3.5" aria-hidden />
            {t("purgeHint")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("historyTitle")}</CardTitle>
          <CardDescription>{t("historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            runs.map((run) => {
              let dryRun = false;
              let result: {
                results?: Array<{ resource?: string; affected?: number; skipped?: string }>;
              } | null = null;
              try {
                dryRun = JSON.parse(run.payload || "{}").dryRun !== false;
              } catch {
                dryRun = true;
              }
              try {
                result = run.result ? JSON.parse(run.result) : null;
              } catch {
                result = null;
              }
              return (
                <div key={run.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
                        {run.status}
                      </Badge>
                      <span className="text-sm font-medium">
                        {dryRun ? t("dryRun") : t("purge")}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format.dateTime(run.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  {run.publicError ? (
                    <p className="mt-2 text-sm text-destructive">{run.publicError}</p>
                  ) : null}
                  {result?.results?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.results.map((item) => (
                        <Badge key={String(item.resource)} variant="secondary">
                          {item.resource}: {item.skipped ?? format.number(item.affected ?? 0)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
