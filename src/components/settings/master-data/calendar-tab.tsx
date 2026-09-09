import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  createAcademicPeriod,
  createAcademicYear,
  updateMasterDataStatus,
} from "@/modules/master-data/actions";
import type { readMasterData } from "@/modules/master-data/queries";

type MasterData = Awaited<ReturnType<typeof readMasterData>>;
const YEAR_STATUSES = ["planned", "active", "closed"] as const;

export async function MasterDataCalendarTab({ data }: { data: MasterData }) {
  const t = await getTranslations("masterData");
  return (
    <TabsContent value="calendar" className="grid gap-4 pt-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("year.new")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAcademicYear} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="grid gap-1 text-sm">
              <span>{t("fields.code")}</span>
              <Input name="code" required maxLength={80} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-1 xl:col-span-2">
              <span>{t("fields.label")}</span>
              <Input name="label" required maxLength={160} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.startsOn")}</span>
              <Input name="startsOn" required type="date" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.endsOn")}</span>
              <Input name="endsOn" required type="date" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.status")}</span>
              <select
                name="status"
                defaultValue="planned"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                {YEAR_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-2 xl:col-span-6 flex justify-end">
              <Button type="submit">
                <Plus className="size-4" aria-hidden />
                {t("create")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        {data.years.map((year) => (
          <Card key={year.id}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{year.label}</p>
                  <Badge variant="outline">{year.code}</Badge>
                  <Badge variant="secondary">{t(`status.${year.status}`)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                  {year.startsOn} — {year.endsOn}
                </p>
              </div>
              <form action={updateMasterDataStatus} className="flex items-center gap-2">
                <input type="hidden" name="kind" value="academic_year" />
                <input type="hidden" name="id" value={year.id} />
                <input type="hidden" name="version" value={year.version} />
                <select
                  name="status"
                  defaultValue={year.status}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {YEAR_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  {t("update")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.years.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("period.new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createAcademicPeriod}
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-8"
            >
              <label className="grid gap-1 text-sm xl:col-span-2">
                <span>{t("period.year")}</span>
                <select
                  name="academicYearId"
                  required
                  defaultValue=""
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    —
                  </option>
                  {data.years.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.code")}</span>
                <Input name="code" required maxLength={80} />
              </label>
              <label className="grid gap-1 text-sm xl:col-span-2">
                <span>{t("fields.label")}</span>
                <Input name="label" required maxLength={160} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("period.kind")}</span>
                <select
                  name="kind"
                  defaultValue="semester"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="semester">{t("period.kindValues.semester")}</option>
                  <option value="summer">{t("period.kindValues.summer")}</option>
                  <option value="annual">{t("period.kindValues.annual")}</option>
                  <option value="custom">{t("period.kindValues.custom")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("period.position")}</span>
                <Input name="position" type="number" min="0" defaultValue="1" />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.status")}</span>
                <select
                  name="status"
                  defaultValue="planned"
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {YEAR_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.startsOn")}</span>
                <Input name="startsOn" required type="date" />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.endsOn")}</span>
                <Input name="endsOn" required type="date" />
              </label>
              <div className="md:col-span-2 xl:col-span-6 flex items-end justify-end">
                <Button type="submit">
                  <Plus className="size-4" aria-hidden />
                  {t("create")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        {data.periods.map((period) => (
          <Card key={period.id}>
            <CardContent className="grid gap-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{period.label}</p>
                  <Badge variant="outline">{period.code}</Badge>
                  <Badge variant="secondary">{t(`status.${period.status}`)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {period.academicYearLabel} · {t(`period.kindValues.${period.kind}`)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                  {period.startsOn} — {period.endsOn}
                </p>
              </div>
              <form action={updateMasterDataStatus} className="flex items-center justify-end gap-2">
                <input type="hidden" name="kind" value="academic_period" />
                <input type="hidden" name="id" value={period.id} />
                <input type="hidden" name="version" value={period.version} />
                <select
                  name="status"
                  defaultValue={period.status}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {YEAR_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`status.${status}`)}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  {t("update")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </TabsContent>
  );
}
