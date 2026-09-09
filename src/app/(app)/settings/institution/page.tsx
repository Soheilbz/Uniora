import { getTranslations } from "next-intl/server";
import { InstitutionForm } from "@/components/settings/institution-form";
import { requireCapability } from "@/lib/viewer.ts";
import { saveInstitution } from "@/modules/settings/institution.ts";
import { readInstitution } from "@/modules/settings/institution-queries.ts";

/**
 * The letterhead every printed instrument is issued under.
 *
 * Its own capability, not the one that maintains reference lists: a vocabulary
 * is a list a research officer curates as departments change, and this is the
 * name a signed form comes out under.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("institution.title") };
}

export default async function InstitutionPage() {
  const viewer = await requireCapability("institution.manage");

  const [institution, t] = await Promise.all([
    readInstitution(viewer.tenantId),
    getTranslations("settings"),
  ]);

  const words: Record<string, string> = {
    title: t("institution.title"),
    subtitle: t("institution.subtitle"),
    name: t("institution.name"),
    nameEn: t("institution.nameEn"),
    faculty: t("institution.faculty"),
    address: t("institution.address"),
    phone: t("institution.phone"),
    email: t("institution.email"),
    website: t("institution.website"),
    contactTitle: t("institution.contactTitle"),
    contactSubtitle: t("institution.contactSubtitle"),
    crest: t("institution.crest"),
    crestHint: t("institution.crestHint"),
    crestNone: t("institution.crestNone"),
    crestRemove: t("institution.crestRemove"),
    crestTooLarge: t("institution.crestTooLarge"),
    crestWrongType: t("institution.crestWrongType"),
    systemTitle: t("institution.systemTitle"),
    systemSubtitle: t("institution.systemSubtitle"),
    timezone: t("institution.timezone"),
    locale: t("institution.locale"),
    calendarSystem: t("institution.calendarSystem"),
    localeFa: t("institution.localeFa"),
    localeEn: t("institution.localeEn"),
    calendarJalali: t("institution.calendarJalali"),
    calendarGregorian: t("institution.calendarGregorian"),
    sessionHours: t("institution.sessionHours"),
    passwordMinLength: t("institution.passwordMinLength"),
    required: t("error.required"),
    invalidEmail: t("error.invalidEmail"),
    invalidUrl: t("error.invalidUrl"),
    invalidTimezone: t("error.invalidTimezone"),
    invalidOption: t("error.invalidOption"),
    invalidNumber: t("error.invalidNumber"),
    save: t("save"),
    saved: t("saved"),
    saveFailed: t("saveFailed"),
    tooLong: t("error.tooLong"),
    conflict: t("error.conflict"),
  };

  return <InstitutionForm action={saveInstitution} institution={institution} t={words} />;
}
