import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createRegulationAction,
  publishRegulationAction,
  retireRegulationAction,
} from "@/modules/governance/actions.ts";
import { listCapacityRegulations } from "@/modules/governance/official-rules.ts";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("regulations.title") };
}

export default async function RegulationsPage() {
  const viewer = await requireCapability("regulations.manage");
  const [t, rows] = await Promise.all([
    getTranslations("settings"),
    listCapacityRegulations(viewer.tenantId),
  ]);
  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-lg font-semibold">{t("regulations.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("regulations.subtitle")}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("regulations.newDraft")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createRegulationAction} className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>{t("regulations.version")}</span>
              <Input name="versionCode" required maxLength={40} dir="ltr" placeholder="01" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("regulations.name")}</span>
              <Input name="title" required maxLength={240} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("regulations.effectiveFrom")}</span>
              <Input name="effectiveFrom" type="date" required dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("regulations.effectiveTo")}</span>
              <Input name="effectiveTo" type="date" dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("regulations.reference")}</span>
              <Input name="publicationReference" maxLength={500} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("regulations.approvedBy")}</span>
              <Input name="approvedBy" maxLength={240} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span>{t("regulations.rulesJson")}</span>
              <Textarea
                name="rulesJson"
                rows={8}
                dir="ltr"
                spellCheck={false}
                placeholder={t("regulations.rulesHint")}
              />
            </label>
            <div className="md:col-span-2">
              <Button type="submit">{t("regulations.create")}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("regulations.empty")}</p>
        ) : (
          rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{row.title}</strong>
                    <Badge variant={row.status === "published" ? "default" : "outline"}>
                      {row.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
                    v{row.versionCode} · {row.effectiveFrom}
                    {row.effectiveTo ? ` → ${row.effectiveTo}` : ""}
                  </p>
                  <code
                    className="mt-2 block max-w-full overflow-hidden text-ellipsis text-xs text-muted-foreground"
                    dir="ltr"
                  >
                    SHA-256 {row.rulesSha256}
                  </code>
                </div>
                <div className="flex gap-2">
                  {row.status === "draft" ? (
                    <form action={publishRegulationAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <Button size="sm" type="submit">
                        {t("regulations.publish")}
                      </Button>
                    </form>
                  ) : null}
                  {row.status === "published" ? (
                    <form action={retireRegulationAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <Button size="sm" variant="outline" type="submit">
                        {t("regulations.retire")}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
