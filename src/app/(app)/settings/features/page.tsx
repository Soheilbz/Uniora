import { Check, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { FEATURE_CATALOG, readTenantFeatures } from "@/lib/features.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { updateTenantFeature } from "@/modules/settings/features.ts";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("features.title") };
}

export default async function FeatureSettingsPage() {
  const viewer = await requireCapability("features.manage");
  const [t, values] = await Promise.all([
    getTranslations("settings"),
    readTenantFeatures(viewer.tenantId),
  ]);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-lg font-semibold">{t("features.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("features.subtitle")}</p>
      </div>
      <div className="grid gap-3">
        {FEATURE_CATALOG.map((item) => {
          const enabled = values.get(item.key) ?? item.defaultEnabled;
          const messageKey = item.key.replace(/[.-]/g, "_");
          return (
            <Card key={item.key}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {t(`features.catalog.${messageKey}.name`)}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`features.catalog.${messageKey}.description`)}
                    </p>
                  </div>
                  <Badge variant={enabled ? "default" : "outline"} className="gap-1">
                    {enabled ? (
                      <Check className="size-3" aria-hidden />
                    ) : (
                      <X className="size-3" aria-hidden />
                    )}
                    {enabled ? t("features.enabled") : t("features.disabled")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <code className="rounded bg-muted px-2 py-1 text-xs" dir="ltr">
                  {item.key}
                </code>
                <form action={updateTenantFeature}>
                  <input type="hidden" name="feature" value={item.key} />
                  <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
                  <Button type="submit" variant={enabled ? "outline" : "default"} size="sm">
                    {enabled ? t("features.disable") : t("features.enable")}
                  </Button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
