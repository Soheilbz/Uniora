/**
 * Digits inside a string, shown in the reader's own numerals.
 *
 * ── Why this is not `Intl.NumberFormat` ─────────────────────────────────────
 *
 * A student number is not a number. `Intl.NumberFormat("fa").format(40012345)`
 * gives «۴۰٬۰۱۲٬۳۴۵» — correct for a quantity and wrong for an identifier,
 * because it groups thousands, and «۴۰٬۰۱۲٬۳۴۵» is not a student number anybody
 * can read back to a colleague or type into another system. It also drops the
 * leading zeros that a national id depends on.
 *
 * So this maps digit characters and touches nothing else: no grouping, no
 * rounding, no loss of leading zeros, and any letters or punctuation in the
 * string are left exactly where they were. `Intl` remains the right tool for
 * quantities — GPAs, unit counts, record totals — and is used for those.
 *
 * The stored value stays ASCII throughout; this is a rendering decision made at
 * the last moment. `validation.ts` folds the other way on the way in, so what
 * the database holds is always ASCII no matter which keyboard typed it.
 */

const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Persian and Arabic-Indic digits, folded to ASCII.
 *
 * The way in: a clerk typing on a Persian keyboard produces «۴۰۰۱۲۳۴۵», which
 * is neither what `/^\d+$/` matches nor what a national-id checksum can be
 * computed over. Folding at the boundary of every numeric field means a number
 * is a number by the time any rule sees it, and the *stored* value is ASCII —
 * so two records typed on two keyboards are the same student number. This is
 * the counterpart of `toLocaleDigits` above, which is the way out at render
 * time; between them, storage never sees anything but `[0-9]`.
 */
export function foldDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export function toLocaleDigits(value: string, locale: string): string {
  if (!locale.startsWith("fa")) return value;
  return value.replace(/[0-9]/g, (digit) => PERSIAN[Number(digit)] ?? digit);
}

/**
 * Persian digits, whatever the reader has chosen.
 *
 * `toLocaleDigits` follows the interface language, which is right for a screen:
 * a clerk reading in English wants the register's numbers in ASCII. A council
 * document is not a screen. The minute and the checklist are Persian
 * instruments — they are signed, filed and archived in Persian — so they print
 * Persian numerals regardless of the interface language so the archived
 * instrument follows the institution's Persian document convention.
 */
export function toPersianDigits(value: string): string {
  return value.replace(/[0-9]/g, (digit) => PERSIAN[Number(digit)] ?? digit);
}
