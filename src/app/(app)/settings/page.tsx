import { getFormatter, getTranslations } from "next-intl/server";
import { DeviceList } from "@/components/settings/device-list";
import { PasskeyManager } from "@/components/settings/passkey-manager.tsx";
import { DisplayNameForm, PasswordForm } from "@/components/settings/profile-forms";
import { SettingsCard } from "@/components/settings/setting-row";
import { requireViewer } from "@/lib/viewer.ts";
import { changePassword, revokeDevice, saveDisplayName } from "@/modules/settings/profile.ts";
import { readDevices, readProfile } from "@/modules/settings/profile-queries.ts";

/**
 * The account, as its holder sees it.
 *
 * The index of settings, and the one section with no capability on it: everyone
 * signed in has an account, and what is here is what about it is theirs.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("profile.title") };
}

export default async function ProfilePage() {
  const viewer = await requireViewer();

  const [profile, devices, t, capability, format] = await Promise.all([
    readProfile(),
    readDevices(),
    getTranslations("settings"),
    getTranslations("capability"),
    getFormatter(),
  ]);

  /*
   * The words the forms need, resolved here and handed over as data.
   *
   * The forms are client components and a translator cannot cross that boundary
   * — it is a function. Sending the handful of strings they use keeps the
   * catalogue on the server, where the rest of it stays.
   */
  const words: Record<string, string> = {
    name: t("profile.name"),
    title: t("profile.title"),
    subtitle: t("profile.subtitle"),
    save: t("save"),
    saved: t("saved"),
    saveFailed: t("saveFailed"),
    required: t("error.required"),
    tooLong: t("error.tooLong"),
    passwordTitle: t("profile.passwordTitle"),
    passwordSubtitle: t("profile.passwordSubtitle"),
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
    username: t("profile.username"),
    email: t("profile.email"),
    signOutDevice: t("profile.signOutDevice"),
    currentDevice: t("profile.currentDevice"),
    unknownDevice: t("profile.unknownDevice"),
    noSessions: t("profile.noSessions"),
    sessionRevoked: t("profile.sessionRevoked"),
    sessionsTitle: t("profile.sessionsTitle"),
    sessionsSubtitle: t("profile.sessionsSubtitle"),
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top 2-Column Grid: Profile Information & Password Form */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <DisplayNameForm
          action={saveDisplayName}
          initial={profile.name}
          username={profile.username ?? "—"}
          email={profile.email}
          t={words}
        />
        <PasswordForm
          action={changePassword}
          t={words}
          minPasswordLength={viewer.tenantPasswordMinLength}
        />
      </div>

      <PasskeyManager
        words={{
          title: t("profile.passkeys.title"),
          description: t("profile.passkeys.description"),
          name: t("profile.passkeys.name"),
          add: t("profile.passkeys.add"),
          adding: t("profile.passkeys.adding"),
          delete: t("profile.passkeys.delete"),
          empty: t("profile.passkeys.empty"),
          backedUp: t("profile.passkeys.backedUp"),
          device: t("profile.passkeys.device"),
          error: t("profile.passkeys.error"),
        }}
      />

      {/*
       * What this account may actually do, in sentences rather than as a list
       * of keys.
       *
       * The names alone («مدیریت کاربران») are the same words the roles screen
       * uses, and somebody reading their own profile is usually asking a
       * different question — why can I not open that screen. The `what` line is
       * the answer, and it is why this is a list of paragraphs and not chips.
       */}
      <SettingsCard title={t("profile.capabilities")} description={t("profile.subtitle")}>
        {viewer.capabilities.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t("profile.noCapabilities")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            {viewer.capabilities.map((held) => (
              <div
                key={held}
                className="flex flex-col justify-between gap-2 rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-2xs transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-xs"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="flex size-2 shrink-0 rounded-full bg-primary" />
                    <span className="text-xs font-bold text-foreground">
                      {capability(`${held}.name`)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed ps-4">
                    {capability(`${held}.what`)}
                  </p>
                </div>

                <div className="flex justify-start ps-4 pt-1">
                  <span
                    className="inline-block rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
                    dir="ltr"
                  >
                    {held}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      <DeviceList
        devices={devices.map((device) => ({
          id: device.id,
          current: device.current,
          since: format.dateTime(device.createdAt, { dateStyle: "medium", timeStyle: "short" }),
          agent: device.userAgent,
          address: device.ipAddress,
        }))}
        action={revokeDevice}
        t={words}
      />
    </div>
  );
}
