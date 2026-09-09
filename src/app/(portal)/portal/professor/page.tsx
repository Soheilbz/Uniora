import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { requireViewer } from "@/lib/viewer.ts";
import { readProfessorPortal } from "@/modules/portal/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("portal.professor");
  return { title: t("title") };
}

export default async function ProfessorPortalPage() {
  const viewer = await requireViewer();
  const data = await readProfessorPortal(viewer);
  if (!data) notFound();
  const [t, common, format] = await Promise.all([
    getTranslations("portal.professor"),
    getTranslations("portal"),
    getFormatter(),
  ]);
  const name = [data.professor.firstName, data.professor.lastName].filter(Boolean).join(" ") || "—";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{name}</CardTitle>
          <CardDescription>
            {data.professor.professorCode} · {data.professor.academicRank || "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label={t("faculty")} value={data.professor.faculty} />
          <Info label={t("department")} value={data.professor.department} />
          <Info label={t("specialization")} value={data.professor.specialization} />
          <Info label={t("email")} value={data.professor.email} />
          <Info label={t("phone")} value={data.professor.phone} />
          <Info label={t("employmentStatus")} value={data.professor.employmentStatus} />
        </CardContent>
      </Card>
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("supervisions")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.supervisions.length ? (
              data.supervisions.map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.role}</Badge>
                    <strong>{row.studentName || row.studentNumber}</strong>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.studentNumber} · {row.degree || "—"} · {row.status}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{common("empty")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("capacity")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.capacities.length ? (
              data.capacities.map((row) => (
                <div
                  key={row.year}
                  className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm"
                >
                  <strong>{row.year}</strong>
                  <span>
                    {t("capacityLine", {
                      phd: row.doctorateConcurrentTotal ?? 0,
                      masters: row.mastersConcurrentTotal ?? 0,
                    })}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{common("empty")}</p>
            )}
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("tasks")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.assignedTasks.length ? (
              data.assignedTasks.map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{row.status}</Badge>
                    <Badge variant="outline">{row.priority}</Badge>
                  </div>
                  <p className="mt-2 font-medium">{row.title}</p>
                  {row.dueAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format.dateTime(row.dueAt, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{common("empty")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("workshops")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.workshopHistory.length ? (
              data.workshopHistory.map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <p className="font-medium">{row.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.workshopDate
                      ? format.dateTime(new Date(row.workshopDate), { dateStyle: "medium" })
                      : "—"}{" "}
                    · {row.role}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{common("empty")}</p>
            )}
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>{t("documents")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.documents.length ? (
            data.documents.map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {format.number(row.sizeBytes)} {common("bytes")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={`/portal/documents/${row.id}/download`}>
                      <Download aria-hidden />
                      {common("download")}
                    </Link>
                  }
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{common("empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "—"}</p>
    </div>
  );
}
