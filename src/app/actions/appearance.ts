"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/i18n/routing";
import {
  APPEARANCE_COOKIE,
  type Appearance,
  BRANDS,
  DENSITIES,
  FONT_SCALES,
  readAppearance,
} from "@/lib/appearance.ts";

/**
 * Switching the interface language.
 *
 * A Server Action rather than a client-side i18n toggle, because the catalogue
 * is chosen on the server: the strings are substituted before anything reaches
 * the browser, so a person downloads one language rather than two and never sees
 * a flash of the wrong one. Changing it means changing what the *server*
 * renders, which means a cookie and a re-render.
 *
 * The value is validated against the closed list of locales before it is
 * written. A cookie whose value reaches a dynamic `import()` of a message file
 * is a path fragment somebody else controls.
 */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    /*
     * Readable by the client, deliberately: this is a display preference and not
     * a credential, and `httpOnly` would only stop the sign-in page — the one
     * screen that renders before anybody is known — from honouring the choice.
     */
    httpOnly: false,
  });

  // Every page's text changes, so the whole tree is stale, not just this route.
  revalidatePath("/", "layout");
}

/**
 * Changing one of the display preferences.
 *
 * One field at a time, merged into what is already stored, because that is how
 * the screen is used — somebody changes the density, not the whole set. Sending
 * the whole object from the browser would also mean trusting the browser's copy
 * of the other three.
 *
 * Every value is checked against its closed list here as well as on the way
 * out. The reader is careful because a cookie can be hand-edited; this is
 * careful because a Server Action is a public endpoint, and «only our own form
 * calls it» has never been true of one.
 */
export async function setAppearance(field: keyof Appearance, value: string) {
  const lists = { brand: BRANDS, density: DENSITIES, fontScale: FONT_SCALES } as const;
  const allowed = lists[field] as readonly string[] | undefined;
  if (!allowed?.includes(value)) return;

  const next = { ...(await readAppearance()), [field]: value };

  const store = await cookies();
  store.set(APPEARANCE_COOKIE, JSON.stringify(next), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    /* Readable by the client for the same reason the locale is: a display
       preference is not a credential, and the sign-in page renders before
       anybody is known. */
    httpOnly: false,
  });

  /* The attributes live on `<html>`, which the root layout writes — so the
     whole tree is stale, not this route. */
  revalidatePath("/", "layout");
}
