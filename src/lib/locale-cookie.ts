"use client";

import { LOCALE_COOKIE, type Locale } from "@/i18n/routing";

/**
 * Keep the display preference available to the next server render immediately.
 * The server action remains authoritative and validates the same closed list;
 * this small client-side write prevents a refresh race in WebKit while the
 * action response is still being committed.
 */
export function writeLocaleCookie(locale: Locale) {
  // biome-ignore lint/suspicious/noDocumentCookie: locale is a validated, non-sensitive display preference.
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
