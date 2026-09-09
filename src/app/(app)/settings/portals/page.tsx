import { notFound } from "next/navigation";
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
import { isTenantFeatureEnabled } from "@/lib/features.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { savePortalLink, setPortalLinkStatus } from "@/modules/portal/actions.ts";
import { readPortalAdministration } from "@/modules/portal/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("portalAdmin");
  return { title: t("title") };
}

export default async function PortalAdministrationPage() {
  const viewer = await requireCapability("users.manage");
  if (!(await isTenantFeatureEnabled(viewer.tenantId, "portals"))) notFound();
  const [t, data] = await Promise.all([
    getTranslations("portalAdmin"),
    readPortalAdministration(viewer.tenantId),
  ]);
  const inputClass =
    "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("linkStudent")}</CardTitle>
            <CardDescription>{t("linkStudentHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={savePortalLink} className="grid gap-3">
              <input type="hidden" name="subjectType" value="student" />
              <label className="grid gap-1.5 text-sm">
                <span>{t("user")}</span>
                <select name="userId" required className={inputClass}>
                  <option value="">{t("select")}</option>
                  {data.users.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.username || row.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>{t("student")}</span>
                <select name="subjectId" required className={inputClass}>
                  <option value="">{t("select")}</option>
                  {data.students.map((row) => (
                    <option key={row.id} value={row.id}>
                      {[row.firstName, row.lastName].filter(Boolean).join(" ")} ·{" "}
                      {row.studentNumber}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit">{t("save")}</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("linkProfessor")}</CardTitle>
            <CardDescription>{t("linkProfessorHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={savePortalLink} className="grid gap-3">
              <input type="hidden" name="subjectType" value="professor" />
              <label className="grid gap-1.5 text-sm">
                <span>{t("user")}</span>
                <select name="userId" required className={inputClass}>
                  <option value="">{t("select")}</option>
                  {data.users.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.username || row.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>{t("professor")}</span>
                <select name="subjectId" required className={inputClass}>
                  <option value="">{t("select")}</option>
                  {data.professors.map((row) => (
                    <option key={row.id} value={row.id}>
                      {[row.firstName, row.lastName].filter(Boolean).join(" ")} ·{" "}
                      {row.professorCode}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit">{t("save")}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("links")}</CardTitle>
          <CardDescription>{t("linksHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            data.links.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate">{row.userName}</strong>
                    <Badge variant="outline">
                      {t(row.subjectType === "student" ? "student" : "professor")}
                    </Badge>
                    <Badge variant={row.status === "active" ? "secondary" : "outline"}>
                      {t(`status.${row.status}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground" dir="ltr">
                    {row.username || row.userId} · {row.studentId || row.professorId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["active", "suspended", "revoked"] as const)
                    .filter((status) => status !== row.status)
                    .map((status) => (
                      <form key={status} action={setPortalLinkStatus}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="version" value={row.version} />
                        <input type="hidden" name="status" value={status} />
                        <Button
                          type="submit"
                          size="sm"
                          variant={status === "revoked" ? "destructive" : "outline"}
                        >
                          {t(`actions.${status}`)}
                        </Button>
                      </form>
                    ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
