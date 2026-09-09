import { ArrowRight, GraduationCap, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { currentPlatformOperator } from "@/lib/platform-viewer.ts";
import { readPreAuthLetterhead } from "@/modules/settings/institution-queries";
import { FeaturePanel } from "../../sign-in/feature-panel";
import { LanguageSwitch } from "../../sign-in/language-switch";
import { SignInForm } from "../../sign-in/sign-in-form";

export const dynamic = "force-dynamic";

export default async function PlatformSignInPage() {
  const operator = await currentPlatformOperator();
  if (operator) {
    if (!operator.mfaEnabled) redirect("/platform/security/setup");
    if (!operator.mfaVerified) redirect("/platform/security/challenge?next=/platform");
    redirect("/platform");
  }

  const [t, app, letterhead, locale] = await Promise.all([
    getTranslations("platform"),
    getTranslations("app"),
    readPreAuthLetterhead(),
    getLocale(),
  ]);
  const isEnglish = locale === "en";

  return (
    <div
      dir={isEnglish ? "ltr" : "rtl"}
      className="login-page grid min-h-svh w-full lg:h-svh lg:overflow-hidden lg:grid-cols-[minmax(0,0.92fr)_minmax(32rem,1.08fr)]"
    >
      <main className="login-main order-1 flex min-h-0 flex-col justify-between p-5 pb-8 sm:p-8 sm:pb-10 md:p-10 md:pb-12 lg:p-12 lg:py-8 lg:pb-12 xl:px-14 xl:py-10 xl:pb-14">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="login-mark flex size-9 shrink-0 items-center justify-center rounded-md">
              <GraduationCap className="size-4" aria-hidden />
            </span>
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {app("name")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageSwitch
              current={isEnglish ? "en" : "fa"}
              label={t("signInKicker")}
              fa="فارسی"
              en="English"
            />
            <ThemeToggle label={t("signInKicker")} />
          </div>
        </div>

        <div className="my-auto flex items-center justify-center py-3 sm:py-5">
          <div className="w-full max-w-sm">
            <Card className="login-card">
              <CardHeader className="login-card-header border-b pb-4 text-start">
                <p className="login-eyebrow mb-2 text-xs font-bold leading-5">
                  {t("signInKicker")}
                </p>
                <h1 className="text-[1.9rem] font-semibold leading-[1.35] tracking-tight sm:text-3xl">
                  {t("signInTitle")}
                </h1>
                <CardDescription className="mt-2 max-w-[30rem] text-start text-sm leading-6 text-pretty">
                  {t("signInSubtitle")}
                </CardDescription>
              </CardHeader>
              <CardContent className="login-card-content pt-4">
                <SignInForm
                  platformMode
                  successPath="/platform"
                  labels={{
                    tenant: "",
                    tenantHint: "",
                    tenantPlaceholder: "",
                    tenantRequired: "",
                    username: t("username"),
                    usernameHint: t("usernameHint"),
                    usernamePlaceholder: t("usernamePlaceholder"),
                    usernameRequired: t("usernameRequired"),
                    password: t("password"),
                    passwordHint: t("passwordHint"),
                    passwordRequired: t("passwordRequired"),
                    showPassword: t("showPassword"),
                    hidePassword: t("hidePassword"),
                    capsLock: t("capsLock"),
                    remember: t("remember"),
                    rememberHint: t("rememberHint"),
                    submit: t("signIn"),
                    submitting: t("submitting"),
                    errorTitle: t("errorTitle"),
                    failed: t("failed"),
                    tooManyAttempts: t("tooManyAttempts"),
                    unreachable: t("unreachable"),
                    forgotHint: t("forgotHint"),
                    passkey: t("passkey"),
                    passkeyFailed: t("passkeyFailed"),
                    sso: t("sso"),
                    ssoFailed: t("ssoFailed"),
                    ssoUnavailable: t("ssoUnavailable"),
                  }}
                />
              </CardContent>
            </Card>

            <Link
              href="/sign-in"
              className="mt-3 flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <ArrowRight className="size-3.5" aria-hidden />
              {t("backToUniversitySignIn")}
            </Link>

            <div className="login-security mt-4 flex flex-col items-center justify-center gap-1 text-xs">
              <div className="flex items-center justify-center gap-2">
                <ShieldCheck className="size-3.5" aria-hidden />
                <span>{app("name")}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-muted-foreground">{t("operatorBadge")}</div>
      </main>

      <FeaturePanel letterhead={letterhead} locale={isEnglish ? "en" : "fa"} />
    </div>
  );
}
