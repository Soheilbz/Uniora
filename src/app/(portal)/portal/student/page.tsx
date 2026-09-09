import { Download, ExternalLink } from "lucide-react";
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
import { readStudentPortal } from "@/modules/portal/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("portal.student");
  return { title: t("title") };
}

export default async function StudentPortalPage() {
  const viewer = await requireViewer();
  const data = await readStudentPortal(viewer);
  if (!data) notFound();
  const [t, common, format] = await Promise.all([
    getTranslations("portal.student"),
    getTranslations("portal"),
    getFormatter(),
  ]);
  const name = [data.student.firstName, data.student.lastName].filter(Boolean).join(" ") || "—";
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{name}</CardTitle>
          <CardDescription>
            {data.student.studentNumber} · {data.student.degree || "—"} · {data.student.status}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label={t("faculty")} value={data.student.faculty} />
          <Info label={t("department")} value={data.student.department} />
          <Info label={t("field")} value={data.student.fieldOfStudy} />
          <Info label={t("email")} value={data.student.email} />
          <Info label={t("phone")} value={data.student.phone} />
          <Info label={t("gpa")} value={data.student.overallGpa?.toString()} />
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("supervision")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.supervision.length ? (
              data.supervision.map((row) => (
                <div
                  key={`${row.role}-${row.professorName}-${row.department}`}
                  className="rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.role}</Badge>
                    <strong>{row.professorName || "—"}</strong>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.department || "—"}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{common("empty")}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("decisions")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {data.decisions.length ? (
              data.decisions.map((row) => (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{row.reviewStatus}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {row.meetingDate
                        ? format.dateTime(new Date(row.meetingDate), { dateStyle: "medium" })
                        : "—"}
                    </span>
                  </div>
                  <p className="mt-2 font-medium">{row.thesisTitle || row.reportCategory || "—"}</p>
                  {row.decisionText ? (
                    <p className="mt-1 text-sm text-muted-foreground">{row.decisionText}</p>
                  ) : null}
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
          <CardTitle>{t("workshops")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.workshopHistory.length ? (
            data.workshopHistory.map((row) => (
              <div
                key={row.workshopId}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.workshopDate
                      ? format.dateTime(new Date(row.workshopDate), { dateStyle: "medium" })
                      : "—"}{" "}
                    · {row.attendanceStatus}
                  </p>
                </div>
                {row.verificationCode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link
                        href={`/verify/certificate/${encodeURIComponent(row.verificationCode)}`}
                      >
                        <ExternalLink aria-hidden />
                        {t("verifyCertificate")}
                      </Link>
                    }
                  />
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
