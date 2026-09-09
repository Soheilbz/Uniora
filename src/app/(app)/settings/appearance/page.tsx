import { getLocale, getTranslations } from "next-intl/server";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { BRANDS, DENSITIES, FONT_SCALES, readAppearance } from "@/lib/appearance.ts";
import { requireViewer } from "@/lib/viewer.ts";

/**
 * How the interface looks, for whoever is reading it.
 *
 * No capability: these are display preferences, they belong to the person
 * rather than to the institution, and there is nothing here anybody needs to be
 * protected from.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("appearance.title") };
}

export default async function AppearancePage() {
  await requireViewer();

  const [appearance, locale, t] = await Promise.all([
    readAppearance(),
    getLocale(),
    getTranslations("settings.appearance"),
  ]);

  /* Flattened for the client component, which cannot be handed a translator. */
  const words: Record<string, string> = {
    title: t("title"),
    subtitle: t("subtitle"),
    theme: t("theme.title"),
    "theme.light": t("theme.light"),
    "theme.dark": t("theme.dark"),
    "theme.system": t("theme.system"),
    brand: t("brand.title"),
    "brand.default": t("brand.default"),
    "brand.blue": t("brand.blue"),
    "brand.teal": t("brand.teal"),
    "brand.violet": t("brand.violet"),
    "brand.rose": t("brand.rose"),
    "brand.amber": t("brand.amber"),
    density: t("density.title"),
    "density.comfortable": t("density.comfortable"),
    "density.compact": t("density.compact"),
    densityHint: t("densityHint"),
    fontScale: t("fontScale"),
    fontScaleNormal: t("fontScaleNormal"),
    smaller: t("smaller"),
    larger: t("larger"),
    previewTitle: t("previewTitle"),
    previewText: t("previewText"),
    localeTitle: t("localeTitle"),
    localeSubtitle: t("localeSubtitle"),
    language: t("language"),
    dateFormat: t("dateFormat"),
    "date.jalali": t("date.jalali"),
    "date.gregorian": t("date.gregorian"),
    dateFormatHint: t("dateFormatHint"),
    languageFa: t("languageFa"),
    languageEn: t("languageEn"),
    syncNote: t("syncNote"),
  };

  return (
    <AppearanceSettings
      appearance={appearance}
      locale={locale}
      brands={BRANDS}
      densities={DENSITIES}
      scales={FONT_SCALES}
      t={words}
    />
  );
}
