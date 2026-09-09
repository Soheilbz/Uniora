import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/portal-shell.tsx";
import { isTenantFeatureEnabled } from "@/lib/features.ts";
import { requireViewer } from "@/lib/viewer.ts";
import { readPortalSubjectKinds } from "@/modules/portal/queries.ts";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  if (viewer.mustChangePassword) redirect("/change-password");
  if (viewer.requireMfa && !viewer.mfaEnabled) redirect("/security/setup");
  if (viewer.requireMfa && viewer.mfaEnabled && !viewer.mfaVerified)
    redirect("/security/challenge");
  if (!(await isTenantFeatureEnabled(viewer.tenantId, "portals"))) notFound();
  const [kinds, t, auth] = await Promise.all([
    readPortalSubjectKinds(viewer),
    getTranslations("portal"),
    getTranslations("auth"),
  ]);
  if (kinds.size === 0) notFound();
  return (
    <PortalShell
      viewer={viewer}
      kinds={kinds}
      words={{
        title: t("title"),
        student: t("student.title"),
        professor: t("professor.title"),
        signOut: auth("signOut"),
      }}
    >
      {children}
    </PortalShell>
  );
}
