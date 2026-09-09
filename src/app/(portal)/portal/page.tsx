import { GraduationCap, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { requireViewer } from "@/lib/viewer.ts";
import { readPortalSubjectKinds } from "@/modules/portal/queries.ts";

export default async function PortalHome() {
  const viewer = await requireViewer();
  const [kinds, t] = await Promise.all([readPortalSubjectKinds(viewer), getTranslations("portal")]);
  if (kinds.size === 1) redirect(kinds.has("student") ? "/portal/student" : "/portal/professor");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {kinds.has("student") ? (
        <Link
          href="/portal/student"
          className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-xl"
        >
          <Card className="h-full transition-colors hover:bg-muted/30">
            <CardHeader>
              <GraduationCap className="size-6 text-primary" aria-hidden />
              <CardTitle>{t("student.title")}</CardTitle>
              <CardDescription>{t("student.description")}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm font-medium text-primary">{t("open")}</CardContent>
          </Card>
        </Link>
      ) : null}
      {kinds.has("professor") ? (
        <Link
          href="/portal/professor"
          className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-xl"
        >
          <Card className="h-full transition-colors hover:bg-muted/30">
            <CardHeader>
              <UserRound className="size-6 text-primary" aria-hidden />
              <CardTitle>{t("professor.title")}</CardTitle>
              <CardDescription>{t("professor.description")}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm font-medium text-primary">{t("open")}</CardContent>
          </Card>
        </Link>
      ) : null}
    </div>
  );
}
