import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import type { readMasterData } from "@/modules/master-data/queries";

type MasterData = Awaited<ReturnType<typeof readMasterData>>;

export async function MasterDataHistoryTab({ data }: { data: MasterData }) {
  const [t, locale] = await Promise.all([getTranslations("masterData"), getLocale()]);
  return (
    <TabsContent value="history" className="grid gap-2 pt-3">
      {data.versions.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t("history.empty")}</p>
      ) : (
        data.versions
          .slice()
          .reverse()
          .map((version) => (
            <Card key={version.id}>
              <CardContent className="flex flex-col gap-2 p-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{version.nameSnapshot}</p>
                    <Badge variant="outline">{version.codeSnapshot}</Badge>
                    <Badge variant="secondary">v{version.versionNo}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {version.parentNameSnapshot ?? t("organization.root")} ·{" "}
                    {version.reason ?? t("history.noReason")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                    {version.validFrom}
                    {version.validTo ? ` — ${version.validTo}` : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(version.createdAt)}
                </span>
              </CardContent>
            </Card>
          ))
      )}
    </TabsContent>
  );
}
