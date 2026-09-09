import { ArrowUpLeft, Database, GraduationCap, Microscope, ShieldCheck, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Letterhead } from "@/modules/settings/institution-queries";

const FEATURES = [
  { number: "01", icon: Database, title: "featureRegistryTitle", body: "featureRegistryBody" },
  { number: "02", icon: Microscope, title: "featureResearchTitle", body: "featureResearchBody" },
  { number: "03", icon: Users, title: "featureEducationTitle", body: "featureEducationBody" },
  { number: "04", icon: ShieldCheck, title: "featureAccessTitle", body: "featureAccessBody" },
] as const;

/**
 * The quiet, editorial half of the sign-in screen.
 *
 * It is intentionally information-rich without looking like a dashboard:
 * warm paper, ink, one clay accent and thin rules give the application a
 * dependable institutional character before the user has signed in.
 */
export async function FeaturePanel({
  letterhead,
  locale,
}: {
  letterhead: Letterhead;
  locale: "fa" | "en";
}) {
  const [t, app] = await Promise.all([getTranslations("auth"), getTranslations("app")]);
  const institutionName =
    locale === "en" && letterhead.nameEn ? letterhead.nameEn : letterhead.name || app("name");
  const institutionFaculty = letterhead.faculty;

  return (
    <aside className="login-showcase order-2 hidden overflow-hidden lg:flex lg:flex-col">
      <div className="login-showcase-rule" aria-hidden />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-10 pb-10 pt-6 xl:px-14 xl:pb-12 xl:pt-8">
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-start">
            <span className="login-showcase-mark flex size-10 items-center justify-center rounded-md">
              <GraduationCap className="size-5" aria-hidden />
            </span>
            <div>
              <p
                className={`text-xs font-semibold text-[var(--login-clay-light)] ${
                  locale === "en" ? "tracking-[0.14em]" : "tracking-normal"
                }`}
              >
                {t("showcaseEyebrow")}
              </p>
              <p className="mt-1 text-sm text-[var(--login-showcase-muted)]">
                {t("showcaseStatus")}
              </p>
            </div>
          </div>
          <span className="login-showcase-index font-mono text-xs" dir="ltr">
            01 / 04
          </span>
        </header>

        <div className="mx-auto my-auto w-full max-w-3xl py-8 text-center">
          <p className="mx-auto mb-5 max-w-sm text-sm leading-7 text-[var(--login-clay-light)]">
            {t("showcaseKicker")}
          </p>
          <h2 className="mx-auto max-w-2xl text-4xl font-semibold leading-[1.25] tracking-tight text-[var(--login-showcase-paper)] xl:text-5xl">
            {t("featuresTitle")}
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-base leading-8 text-[var(--login-showcase-muted)]">
            {t("featuresSubtitle")}
          </p>

          <div className="mx-auto mt-8 grid max-w-2xl border-y border-[var(--login-showcase-line)] sm:grid-cols-2">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.number}
                  className={`group relative flex flex-col items-center gap-3 border-b border-[var(--login-showcase-line)] px-4 py-5 text-center last:border-b-0 ${
                    feature.number === "01" || feature.number === "03" ? "sm:border-e" : ""
                  } ${
                    feature.number === "03" || feature.number === "04"
                      ? "sm:border-b-0 sm:border-t"
                      : ""
                  }`}
                >
                  <span className="font-mono text-xs text-[var(--login-clay-light)]" dir="ltr">
                    {feature.number}
                  </span>
                  <span className="login-showcase-icon flex size-9 shrink-0 items-center justify-center rounded-full">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--login-showcase-paper)]">
                      {t(feature.title)}
                    </h3>
                    <p className="mt-1 text-[0.85rem] leading-7 text-[var(--login-showcase-muted)]">
                      {t(feature.body)}
                    </p>
                  </div>
                  <ArrowUpLeft
                    className="absolute end-3 top-3 size-4 text-[var(--login-showcase-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex items-end justify-between gap-6 border-t border-[var(--login-showcase-line)] pt-5 text-xs text-[var(--login-showcase-muted)]">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-[var(--login-clay-light)]" aria-hidden />
            <span className="truncate">{t("showcaseSecurity")}</span>
          </div>
          <div className="max-w-48 text-end">
            <p className="truncate text-[var(--login-showcase-paper)]">{institutionName}</p>
            {institutionFaculty ? <p className="mt-1 truncate">{institutionFaculty}</p> : null}
          </div>
        </footer>
      </div>
    </aside>
  );
}
