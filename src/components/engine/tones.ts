/**
 * The chip palettes, shared by every screen that draws a value as a chip.
 *
 * Two of them, and the distinction is the whole point.
 *
 * ── `TONES` — identity ──────────────────────────────────────────────────────
 *
 * A value's colour is its *position* in its own vocabulary. Nothing about
 * «کارشناسی ارشد» is greener than «دکتری تخصصی»; what the colour does is let a
 * column of nineteen degrees be nineteen distinguishable chips instead of
 * nineteen identical ones. So the rung is picked by position — never by a hash,
 * and never by a map of value to colour, because both would let a vocabulary
 * edited in the settings screen silently repaint records.
 *
 * The palette lives here because two screens draw the same standing and it must
 * be the same colour on both: a student who is «مرخصی تحصیلی» in one hue on the
 * register and another on their record is a student an operator has to re-read.
 *
 * The alarm band — red and orange — is deliberately absent from this ramp. An
 * identity colour must not read as a warning.
 *
 * ── `STATUS_TONES` — state ──────────────────────────────────────────────────
 *
 * The other four are for the cells where the software genuinely does mean «this
 * is fine» or «this is missing»: present against absent, business against none.
 * There the colour carries the meaning rather than just telling two words
 * apart, so it is chosen by what the value *is*.
 *
 * Both are classes rather than utility strings, and the classes come in matched
 * pairs — background with its own foreground, defined together in `globals.css`
 * under `.ui-category-*` and `.ui-state-*`. A pair must never be split: a chip
 * drawn with one rung's background and another's text is a contrast ratio
 * nobody measured.
 */

export const TONES = [
  "ui-category-1",
  "ui-category-2",
  "ui-category-3",
  "ui-category-4",
  "ui-category-5",
  "ui-category-6",
  "ui-category-7",
  "ui-category-8",
] as const;

export const STATUS_TONES = {
  success: "ui-state-success",
  danger: "ui-state-danger",
  info: "ui-state-info",
  warning: "ui-state-warning",
} as const;

export type StatusTone = keyof typeof STATUS_TONES;
