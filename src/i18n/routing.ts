/**
 * Two languages, and the direction each one is read in.
 *
 * Persian is the default and the reason the whole shell is right-to-left:
 * this is a registry for an Iranian university, and English exists for the
 * occasional exchange student record and for whoever has to read a stack trace.
 *
 * The locale is *not* in the URL. A university office does not link between
 * language versions of the same record, and `/fa/students/...` would double
 * every path for a preference that belongs to a person, not to a page. It is
 * read from the signed-in account, falling back to a cookie for the sign-in
 * screen itself — the one page that has to render before anybody is known.
 */
export const locales = ["fa", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fa";

export const LOCALE_COOKIE = "univ-locale";

/** Persian is written right to left; English is not. Nothing else decides this. */
export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "fa" ? "rtl" : "ltr";
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
