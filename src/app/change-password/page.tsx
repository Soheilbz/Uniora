import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PasswordForm } from "@/components/settings/profile-forms";
import { SettingsCard } from "@/components/settings/setting-row";
import { requireViewer } from "@/lib/viewer.ts";
import { changePassword } from "@/modules/settings/profile.ts";

export const dynamic = "force-dynamic";

export default async function RequiredPasswordChangePage() {
  const viewer = await requireViewer();
  if (!viewer.mustChangePassword) redirect("/");
  const t = await getTranslations("settings");
  const words: Record<string, string> = {
    passwordTitle: t("profile.passwordTitle"),
    passwordSubtitle: t("profile.passwordRequiredFirstLogin"),
    passwordHint: t("profile.passwordHint", { count: viewer.tenantPasswordMinLength }),
    currentPassword: t("profile.currentPassword"),
    newPassword: t("profile.newPassword"),
    confirmPassword: t("profile.confirmPassword"),
    changePassword: t("profile.changePassword"),
    passwordChanged: t("profile.passwordChanged"),
    passwordTooShort: t("profile.passwordTooShort", { count: viewer.tenantPasswordMinLength }),
    passwordTooLong: t("profile.passwordTooLong"),
    passwordMismatch: t("profile.passwordMismatch"),
    showPassword: t("profile.showPassword"),
    hidePassword: t("profile.hidePassword"),
    passwordWrong: t("profile.passwordWrong"),
    securityLocked: t("profile.securityLocked"),
    required: t("error.required"),
    saveFailed: t("saveFailed"),
  };
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg items-center p-6">
      <SettingsCard
        title={t("profile.passwordTitle")}
        description={t("profile.passwordRequiredFirstLogin")}
      >
        <PasswordForm
          action={changePassword}
          t={words}
          minPasswordLength={viewer.tenantPasswordMinLength}
        />
      </SettingsCard>
    </main>
  );
}
