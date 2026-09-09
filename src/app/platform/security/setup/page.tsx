import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePlatformOperator } from "@/lib/platform-viewer.ts";
import { PlatformMfaSetup } from "./setup-form";

export default async function PlatformSecuritySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const operator = await requirePlatformOperator();
  if (operator.mfaEnabled) {
    redirect(operator.mfaVerified ? "/platform" : "/platform/security/challenge?next=/platform");
  }
  const t = await getTranslations("security");
  const params = await searchParams;
  return (
    <PlatformMfaSetup
      initialError={params.error}
      words={{
        setupTitle: t("setupTitle"),
        setupRequired: t("setupRequired"),
        verifyPasswordHint: t("verifyPasswordHint"),
        currentPassword: t("currentPassword"),
        passwordRequired: t("passwordRequired"),
        passwordWrong: t("passwordWrong"),
        locked: t("locked"),
        setupFailed: t("setupFailed"),
        starting: t("starting"),
        start: t("start"),
        secretHint: t("secretHint"),
        scanHint: t("scanHint"),
        manualKeyLabel: t("manualKeyLabel"),
        uriTitle: t("uriTitle"),
        codePlaceholder: t("codePlaceholder"),
        invalidCode: t("invalidCode"),
        confirm: t("confirm"),
      }}
    />
  );
}
