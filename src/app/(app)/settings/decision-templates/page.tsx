import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { requireCapability } from "@/lib/viewer.ts";
import {
  bootstrapDecisionTemplatesAction,
  createDecisionTemplateAction,
  publishDecisionTemplateAction,
} from "@/modules/governance/actions.ts";
import { listDecisionTemplateVersions } from "@/modules/governance/official-rules.ts";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("decisionTemplates.title") };
}

export default async function DecisionTemplatesPage() {
  const viewer = await requireCapability("templates.manage");
  const [t, rows] = await Promise.all([
    getTranslations("settings"),
    listDecisionTemplateVersions(viewer.tenantId),
  ]);
  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("decisionTemplates.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("decisionTemplates.subtitle")}</p>
        </div>
        <form action={bootstrapDecisionTemplatesAction}>
          <Button variant="outline" type="submit">
            {t("decisionTemplates.bootstrap")}
          </Button>
        </form>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("decisionTemplates.newDraft")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createDecisionTemplateAction} className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>{t("decisionTemplates.category")}</span>
              <Input name="category" required dir="ltr" placeholder="thesis_changes" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("decisionTemplates.code")}</span>
              <Input name="templateId" required dir="ltr" placeholder="change_title" />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span>{t("decisionTemplates.name")}</span>
              <Input name="title" required maxLength={240} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span>{t("decisionTemplates.body")}</span>
              <Textarea name="bodyTemplate" required rows={5} maxLength={8000} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span>{t("decisionTemplates.placeholders")}</span>
              <Input name="placeholders" placeholder={t("decisionTemplates.placeholdersHint")} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span>{t("decisionTemplates.description")}</span>
              <Input name="description" maxLength={500} />
            </label>
            <div className="md:col-span-2">
              <Button type="submit">{t("decisionTemplates.create")}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("decisionTemplates.empty")}</p>
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
                    {row.templateCode} · v{row.versionNo}
                  </p>
                  <code
                    className="mt-2 block max-w-full overflow-hidden text-ellipsis text-xs text-muted-foreground"
                    dir="ltr"
                  >
                    SHA-256 {row.contentSha256}
                  </code>
                </div>
                {row.status === "draft" ? (
                  <form action={publishDecisionTemplateAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <Button size="sm" type="submit">
                      {t("decisionTemplates.publish")}
                    </Button>
                  </form>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
