import { FolderKanban, Landmark, Paperclip, Plus } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageBody, PageHeader } from "@/components/page-header.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Input } from "@/components/ui/input.tsx";
import { can } from "@/lib/capabilities.ts";
import { requireModule } from "@/lib/viewer.ts";
import { readProfessorOptions } from "@/modules/directory/options.ts";
import {
  createResearchProject,
  transitionResearchProject,
} from "@/modules/research-projects/actions.ts";
import { readResearchProjects } from "@/modules/research-projects/queries.ts";

const NEXT: Record<string, string[]> = {
  draft: ["draft", "proposed", "cancelled"],
  proposed: ["proposed", "draft", "approved", "cancelled"],
  approved: ["approved", "active", "cancelled"],
  active: ["active", "completed", "cancelled"],
};

export async function generateMetadata() {
  const t = await getTranslations("researchProjects");
  return { title: t("title") };
}

export default async function ResearchProjectsPage() {
  const { viewer } = await requireModule("/research-projects");
  const [t, locale, items, professorOptions] = await Promise.all([
    getTranslations("researchProjects"),
    getLocale(),
    readResearchProjects(viewer.tenantId),
    readProfessorOptions(viewer.tenantId),
  ]);
  const manage = can(viewer, "research-projects.manage");

  return (
    <PageBody className="gap-4">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {manage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createResearchProject}
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            >
              <label className="grid gap-1 text-sm">
                <span>{t("fields.code")}</span>
                <Input name="projectCode" required maxLength={120} />
              </label>
              <label className="grid gap-1 text-sm md:col-span-1 xl:col-span-2">
                <span>{t("fields.title")}</span>
                <Input name="title" required maxLength={1000} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.pi")}</span>
                <select
                  name="principalInvestigatorId"
                  required
                  defaultValue=""
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    —
                  </option>
                  {professorOptions.map((professor) => (
                    <option key={professor.id} value={professor.id}>
                      {professor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.budget")}</span>
                <Input name="budget" inputMode="decimal" maxLength={24} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.currency")}</span>
                <Input name="currency" defaultValue="IRR" maxLength={12} />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span>{t("fields.funding")}</span>
                <Input name="fundingSource" maxLength={500} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.startsOn")}</span>
                <Input name="startsOn" type="date" />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.endsOn")}</span>
                <Input name="endsOn" type="date" />
              </label>
              <div className="md:col-span-2 flex items-end justify-end xl:col-span-2">
                <Button type="submit">
                  <Plus className="size-4" aria-hidden />
                  {t("create")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => {
            const livePi = [item.livePiFirstName, item.livePiLastName]
              .filter(Boolean)
              .join(" ")
              .trim();
            const next = NEXT[item.status] ?? [item.status];
            return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.title}</p>
                      <Badge variant="outline">{item.projectCode}</Badge>
                      <Badge variant="secondary">{t(`status.${item.status}`)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {livePi || item.principalInvestigatorSnapshot}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {item.fundingSource && (
                        <span className="inline-flex items-center gap-1">
                          <Landmark className="size-3" aria-hidden />
                          {item.fundingSource}
                        </span>
                      )}
                      {item.budget && (
                        <span>
                          {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
                            Number(item.budget),
                          )}{" "}
                          {item.currency}
                        </span>
                      )}
                      {item.startsOn && (
                        <span>
                          {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                            new Date(`${item.startsOn}T00:00:00Z`),
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      nativeButton={false}
                      render={
                        <Link href={`/documents?entityType=research_project&entityId=${item.id}`} />
                      }
                      size="sm"
                      variant="ghost"
                    >
                      <Paperclip className="size-4" aria-hidden />
                      {t("documents")}
                    </Button>
                    {manage && next.length > 1 && (
                      <form action={transitionResearchProject} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="version" value={item.version} />
                        <select
                          name="status"
                          defaultValue={item.status}
                          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                        >
                          {next.map((status) => (
                            <option key={status} value={status}>
                              {t(`status.${status}`)}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" variant="outline">
                          {t("update")}
                        </Button>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
