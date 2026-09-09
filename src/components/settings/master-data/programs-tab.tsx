import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { createAcademicProgram, updateMasterDataStatus } from "@/modules/master-data/actions";
import type { readMasterData } from "@/modules/master-data/queries";

type MasterData = Awaited<ReturnType<typeof readMasterData>>;
const PROGRAM_STATUSES = ["active", "inactive", "retired"] as const;

export async function MasterDataProgramsTab({ data }: { data: MasterData }) {
  const t = await getTranslations("masterData");
  const departments = data.units.filter(
    (unit) => unit.type === "department" && unit.status === "active",
  );
  return (
    <TabsContent value="programs" className="grid gap-4 pt-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("program.new")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAcademicProgram} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{t("program.department")}</span>
              <select
                name="departmentId"
                required
                defaultValue=""
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  —
                </option>
                {departments.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.code")}</span>
              <Input name="code" required maxLength={80} />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-3">
              <span>{t("fields.name")}</span>
              <Input name="name" required maxLength={300} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("program.degree")}</span>
              <Input name="degreeLevel" required maxLength={120} />
            </label>
            <label className="grid gap-1 text-sm xl:col-span-2">
              <span>{t("program.field")}</span>
              <Input name="field" required maxLength={300} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("program.orientation")}</span>
              <Input name="orientation" maxLength={300} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.validFrom")}</span>
              <Input name="validFrom" required type="date" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t("fields.validTo")}</span>
              <Input name="validTo" type="date" />
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
      <div className="grid gap-2 md:grid-cols-2">
        {data.programs.map((program) => (
          <Card key={program.id}>
            <CardContent className="grid gap-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{program.name}</p>
                  <Badge variant="outline">{program.code}</Badge>
                  <Badge variant="secondary">{t(`status.${program.status}`)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {program.departmentName ?? "—"} · {program.degreeLevel} · {program.field}
                  {program.orientation ? ` / ${program.orientation}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                  {program.validFrom}
                  {program.validTo ? ` — ${program.validTo}` : ""}
                </p>
              </div>
              <form action={updateMasterDataStatus} className="flex items-center justify-end gap-2">
                <input type="hidden" name="kind" value="academic_program" />
                <input type="hidden" name="id" value={program.id} />
                <input type="hidden" name="version" value={program.version} />
                <select
                  name="status"
                  defaultValue={program.status}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {PROGRAM_STATUSES.map((status) => (
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
