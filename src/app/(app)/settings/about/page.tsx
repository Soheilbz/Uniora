import { Activity, Database, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { requireViewer } from "@/lib/viewer.ts";

/**
 * What is running, for the first two minutes of a support call.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("about.title") };
}

const configuredVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.8.2";
const BUILD = {
  version: configuredVersion.startsWith("v") ? configuredVersion : `v${configuredVersion}`,
  commit: process.env.NEXT_PUBLIC_APP_COMMIT ?? "main",
  node: process.version,
};

export default async function AboutPage() {
  await requireViewer();
  const [t, app] = await Promise.all([getTranslations("settings"), getTranslations("app")]);

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <SettingsCard title={t("about.title")} description={t("about.subtitle")}>
        <SettingRow
          label={app("name")}
          control={
            <span className="numeric text-xs font-bold text-primary font-mono" dir="ltr">
              {BUILD.version}
            </span>
          }
        />
        <SettingRow
          label={t("about.commit")}
          control={
            <span className="numeric text-xs text-muted-foreground font-mono" dir="ltr">
              {BUILD.commit}
            </span>
          }
        />
        <SettingRow
          label={`${t("about.runtime")} (Node.js)`}
          control={
            <span className="numeric text-xs font-mono font-semibold text-foreground" dir="ltr">
              {BUILD.node}
            </span>
          }
        />
        <SettingRow
          label={`${t("about.database")} (PostgreSQL)`}
          control={
            <div
              className="flex items-center gap-1.5 text-xs font-mono text-foreground font-medium"
              dir="ltr"
            >
              <Database className="size-3.5 text-primary" />
              <span>PostgreSQL 18</span>
            </div>
          }
        />
      </SettingsCard>

      <SettingsCard
        title={t("about.architectureTitle")}
        description={t("about.architectureSubtitle")}
      >
        <div className="flex flex-col gap-3 p-1 text-xs text-muted-foreground leading-relaxed">
          <p>{t("about.securityValue")}</p>

          <div className="grid gap-2 sm:grid-cols-2 pt-1">
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-2.5">
              <ShieldCheck className="size-4 shrink-0 text-success-subtle-foreground" />
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-foreground">
                  {t("about.securityTitle")}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("about.securityValue")}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 p-2.5">
              <Activity className="size-4 text-primary shrink-0" />
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-foreground">
                  {t("about.statusTitle")}
                </span>
                <span className="text-[10px] font-semibold text-success-subtle-foreground">
                  {t("about.statusValue")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
