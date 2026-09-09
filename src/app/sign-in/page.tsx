import { GraduationCap, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { currentViewer } from "@/lib/viewer";
import { readPreAuthLetterhead } from "@/modules/settings/institution-queries";
import { FeaturePanel } from "./feature-panel";
import { LanguageSwitch } from "./language-switch";
import { SignInForm } from "./sign-in-form";

/**
 * The only screen that renders before anybody is known.
 *
 * Server-rendered so an already-signed-in person never sees it. Bouncing them
 * on the client instead would flash a login form at somebody who is signed in.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string | string[] }>;
}) {
  const viewer = await currentViewer();
  if (viewer) redirect("/");

  const rawTenant = (await searchParams).tenant;
  const tenant = (Array.isArray(rawTenant) ? rawTenant[0] : rawTenant)?.trim().toLowerCase() ?? "";
  const [t, app, letterhead, locale] = await Promise.all([
    getTranslations("auth"),
    getTranslations("app"),
    readPreAuthLetterhead(tenant),
    getLocale(),
  ]);
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.8.2";
  const displayVersion = appVersion.startsWith("v") ? appVersion : `v${appVersion}`;

  return (
    <div
      dir={locale === "en" ? "ltr" : "rtl"}
      className="login-page grid min-h-svh w-full lg:h-svh lg:overflow-hidden lg:grid-cols-[minmax(0,0.92fr)_minmax(32rem,1.08fr)]"
    >
      {/* ── First Column: Sign In Form & Controls (Right in RTL) ─────── */}
      <main className="login-main order-1 flex min-h-0 flex-col justify-between p-5 pb-8 sm:p-8 sm:pb-10 md:p-10 md:pb-12 lg:p-12 lg:py-8 lg:pb-12 xl:px-14 xl:py-10 xl:pb-14">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {letterhead.crest ? (
              /* biome-ignore lint/performance/noImgElement: data URL crest from institution */
              <img
                src={letterhead.crest}
                alt=""
                className="login-crest size-9 shrink-0 rounded-md border p-1 object-contain"
              />
            ) : (
              <span className="login-mark flex size-9 shrink-0 items-center justify-center rounded-md">
                <GraduationCap className="size-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex flex-col">
              <span className="truncate text-sm font-semibold tracking-tight text-foreground">
                {letterhead.name || app("name")}
              </span>
              {letterhead.faculty ? (
                <span className="truncate text-xs font-medium text-muted-foreground">
                  {letterhead.faculty}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageSwitch
              current={locale === "en" ? "en" : "fa"}
              label={t("languageToggle")}
              fa="فارسی"
              en="English"
            />
            <ThemeToggle label={t("themeToggle")} />
          </div>
        </div>

        {/* Center: Sign In Card */}
        <div className="my-auto flex items-center justify-center py-3 sm:py-5">
          <div className="w-full max-w-sm">
            <Card className="login-card">
              <CardHeader className="login-card-header border-b pb-4 text-start">
                <p
                  className={`login-eyebrow mb-2 text-xs font-bold leading-5 ${
                    locale === "en" ? "uppercase tracking-[0.16em]" : "tracking-normal"
                  }`}
                >
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
                  labels={{
                    tenant: t("tenant"),
                    tenantHint: t("tenantHint"),
                    tenantPlaceholder: t("tenantPlaceholder"),
                    tenantRequired: t("tenantRequired"),
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
                  initialTenant={tenant}
                />
              </CardContent>
            </Card>

            <Link
              href="/platform/sign-in"
              className="mt-3 block text-center text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("platformLink")}
            </Link>

            <div className="login-security mt-4 flex flex-col items-center justify-center gap-1 text-xs">
              <div className="flex items-center justify-center gap-2">
                <ShieldCheck className="size-3.5" aria-hidden />
                <span>{t("secureConnection")}</span>
              </div>
              <p className="text-[0.7rem] opacity-75">{t("designedBy")}</p>
            </div>
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="text-center text-xs text-muted-foreground">
          <span className="numeric font-mono" dir="ltr">
            {displayVersion}
          </span>
        </div>
      </main>

      {/* ── Second Column: Institutional Showcase (Left in RTL) ────────── */}
      <FeaturePanel letterhead={letterhead} locale={locale === "en" ? "en" : "fa"} />
    </div>
  );
}
