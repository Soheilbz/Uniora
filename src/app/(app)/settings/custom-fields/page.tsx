import { getTranslations } from "next-intl/server";
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
  createCustomFieldDefinition,
  setCustomFieldDefinitionStatus,
} from "@/modules/custom-fields/actions.ts";
import {
  CUSTOM_FIELD_DATA_TYPES,
  CUSTOM_FIELD_ENTITY_TYPES,
} from "@/modules/custom-fields/model.ts";
import { readCustomFieldDefinitions } from "@/modules/custom-fields/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("customFields");
  return { title: t("title") };
}
export default async function CustomFieldsSettingsPage() {
  const viewer = await requireCapability("custom-fields.manage");
  const [t, rows] = await Promise.all([
    getTranslations("customFields"),
    readCustomFieldDefinitions(viewer.tenantId),
  ]);
  const cls = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("create")}</CardTitle>
          <CardDescription>{t("guardrail")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createCustomFieldDefinition} className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>{t("entity")}</span>
              <select name="entityType" className={cls} required>
                {CUSTOM_FIELD_ENTITY_TYPES.map((one) => (
                  <option key={one} value={one}>
                    {t(`entities.${one}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("type")}</span>
              <select name="dataType" className={cls} required>
                {CUSTOM_FIELD_DATA_TYPES.map((one) => (
                  <option key={one} value={one}>
                    {t(`types.${one}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("key")}</span>
              <input
                name="key"
                dir="ltr"
                className={cls}
                required
                pattern="[a-z][a-z0-9_]{1,63}"
                maxLength={64}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("label")}</span>
              <input name="label" className={cls} required maxLength={160} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("position")}</span>
              <input
                name="position"
                type="number"
                min={0}
                max={10000}
                defaultValue={0}
                className={cls}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input name="required" type="checkbox" />
              {t("required")}
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span>{t("options")}</span>
              <textarea
                name="options"
                rows={3}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder={t("optionsHint")}
              />
            </label>
            <div className="md:col-span-2">
              <Button type="submit">{t("createAction")}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("existing")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{row.label}</strong>
                    <Badge variant="outline">{t(`entities.${row.entityType}`)}</Badge>
                    <Badge variant="secondary">{t(`types.${row.dataType}`)}</Badge>
                    <Badge variant="outline">{t(`status.${row.status}`)}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                    {row.key}
                  </p>
                </div>
                <form action={setCustomFieldDefinitionStatus}>
                  <input type="hidden" name="id" value={row.id} />
                  <input type="hidden" name="version" value={row.version} />
                  <input
                    type="hidden"
                    name="status"
                    value={row.status === "active" ? "retired" : "active"}
                  />
                  <Button type="submit" variant="outline" size="sm">
                    {t(row.status === "active" ? "retire" : "activate")}
                  </Button>
                </form>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
