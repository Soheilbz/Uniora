import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { createOrganizationUnit, updateOrganizationUnit } from "@/modules/master-data/actions";
import type { readMasterData } from "@/modules/master-data/queries";

type MasterData = Awaited<ReturnType<typeof readMasterData>>;
const UNIT_TYPES = [
  "university",
  "faculty",
  "department",
  "center",
  "institute",
  "office",
  "other",
] as const;
const UNIT_STATUSES = ["active", "inactive", "merged", "closed"] as const;

export async function MasterDataOrganizationTab({ data }: { data: MasterData }) {
  const t = await getTranslations("masterData");
  const versionCounts = new Map<string, number>();
  for (const version of data.versions)
    versionCounts.set(
      version.organizationUnitId,
      (versionCounts.get(version.organizationUnitId) ?? 0) + 1,
    );
  return (
    <TabsContent value="organization" className="grid gap-4 pt-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("organization.new")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={createOrganizationUnit}
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
          >
            <label className="grid gap-1 text-sm">
              <span>{t("organization.type")}</span>
              <select
                name="type"
                defaultValue="department"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                {UNIT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`organization.types.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.code")}</span>
              <Input name="code" required maxLength={80} />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{t("fields.name")}</span>
              <Input name="name" required maxLength={300} />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{t("organization.nameEn")}</span>
              <Input name="nameEn" maxLength={300} dir="ltr" />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{t("organization.parent")}</span>
              <select
                name="parentId"
                defaultValue=""
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">{t("organization.root")}</option>
                {data.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name} ({t(`organization.types.${unit.type}`)})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.validFrom")}</span>
              <Input name="validFrom" required type="date" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.validTo")}</span>
              <Input name="validTo" type="date" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.status")}</span>
              <select
                name="status"
                defaultValue="active"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                {UNIT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-2 xl:col-span-6 flex justify-end">
              <Button type="submit">
                <Building2 className="size-4" aria-hidden />
                {t("create")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        {data.units.map((unit) => (
          <Card key={unit.id}>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,34rem)] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{unit.name}</p>
                  <Badge variant="outline">{unit.code}</Badge>
                  <Badge>{t(`organization.types.${unit.type}`)}</Badge>
                  <Badge variant="secondary">{t(`status.${unit.status}`)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {unit.parentName
                    ? `${t("organization.parent")}: ${unit.parentName}`
                    : t("organization.root")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("organization.versionCount", { count: versionCounts.get(unit.id) ?? 0 })} ·{" "}
                  <span dir="ltr">
                    {unit.validFrom}
                    {unit.validTo ? ` — ${unit.validTo}` : ""}
                  </span>
                </p>
              </div>
              <form
                action={updateOrganizationUnit}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
              >
                <input type="hidden" name="id" value={unit.id} />
                <input type="hidden" name="version" value={unit.version} />
                <label className="grid gap-1 text-xs lg:col-span-2">
                  <span>{t("fields.name")}</span>
                  <Input name="name" defaultValue={unit.name} required maxLength={300} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span>{t("fields.validTo")}</span>
                  <Input name="validTo" type="date" defaultValue={unit.validTo ?? ""} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span>{t("fields.status")}</span>
                  <select
                    name="status"
                    defaultValue={unit.status}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {UNIT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`status.${status}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs lg:col-span-2">
                  <span>{t("organization.nameEn")}</span>
                  <Input name="nameEn" defaultValue={unit.nameEn ?? ""} maxLength={300} dir="ltr" />
                </label>
                <label className="grid gap-1 text-xs lg:col-span-2">
                  <span>{t("organization.reason")}</span>
                  <Input name="reason" maxLength={500} />
                </label>
                <div className="flex items-end justify-end">
                  <Button type="submit" size="sm" variant="outline">
                    {t("update")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </TabsContent>
  );
}
