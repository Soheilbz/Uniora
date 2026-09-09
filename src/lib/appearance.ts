import { cookies } from "next/headers";

/**
 * The display preferences that belong to a person rather than to a page.
 *
 * ── Why these are cookies and not rows ──────────────────────────────────────
 *
 * They have to be known *before* the first byte of HTML is written. A
 * preference read from the database after the page renders is a preference
 * applied as a visible reflow — the table redraws at a different density, the
 * text resizes, and on a slow office machine that happens every navigation. A
 * cookie arrives with the request.
 *
 * The cost is that they follow the browser rather than the account. That is the
 * right trade for what these are: somebody who prefers a compact table on the
 * 24-inch screen at the counter usually wants a comfortable one on the laptop,
 * and the application tied them to the account and had to say so in a
 * note explaining why the laptop looked wrong.
 *
 * ── Why every value is checked against a closed list ────────────────────────
 *
 * Each of these ends up in an attribute on `<html>` or in a CSS custom
 * property. A cookie is a value somebody else can write, and an unchecked one
 * reaching a `style` attribute is an injection point in the one element every
 * page shares.
 */

export const APPEARANCE_COOKIE = "univ.appearance";

/** The accent, as the institution's own colour. */
export const BRANDS = ["default", "blue", "teal", "violet", "rose", "amber"] as const;
export type Brand = (typeof BRANDS)[number];

/** How much air a table row and a form field are given. */
export const DENSITIES = ["comfortable", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/**
 * The interface's text size, as a multiplier of the root font size.
 *
 * A multiplier rather than a pixel size, so everything measured in `rem` moves
 * together — which is the whole interface. What deliberately does not move is a
 * printed worksheet: those are measured against A4 in pixels, because a form
 * that changed its line breaks with a reader's text-size preference would print
 * differently for every clerk.
 */
export const FONT_SCALES = ["0.9", "1", "1.1", "1.25"] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export interface Appearance {
  brand: Brand;
  density: Density;
  fontScale: FontScale;
}

export const DEFAULT_APPEARANCE: Appearance = {
  brand: "default",
  density: "comfortable",
  fontScale: "1",
};

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** The preferences carried on this request, with anything unrecognised dropped. */
export async function readAppearance(): Promise<Appearance> {
  const raw = (await cookies()).get(APPEARANCE_COOKIE)?.value;
  if (!raw) return DEFAULT_APPEARANCE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* A malformed cookie is not an error worth showing anybody — it is a stale
       or hand-edited value, and the defaults are a correct answer. */
    return DEFAULT_APPEARANCE;
  }

  const held = (parsed ?? {}) as Record<string, unknown>;
  return {
    brand: oneOf(BRANDS, held.brand, DEFAULT_APPEARANCE.brand),
    density: oneOf(DENSITIES, held.density, DEFAULT_APPEARANCE.density),
    fontScale: oneOf(FONT_SCALES, held.fontScale, DEFAULT_APPEARANCE.fontScale),
  };
}
