import { getLocale, getTranslations } from "next-intl/server";
import { PrintCell, PrintDocument, PrintTable } from "@/components/settings/print-document";
import { toLocaleDigits } from "@/lib/digits.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readLookupEntries, readLookupSets } from "@/modules/settings/lookup-queries.ts";

/**
 * The institution's vocabularies, on paper.
 *
 * Every set and every value in it, in the order the forms offer them. This is
 * the sheet an office marks up before a revision — «this faculty has closed,
 * that field is now two» — and it is also the only complete statement of what
 * the drop-downs will accept, which is a thing a data-entry standard has to
 * carry in writing.
 *
 * Retired values are printed and marked rather than left out: a value that is
 * no longer offered is still on records filed while it was, so a vocabulary
 * sheet that omitted them would not explain the register it describes.
 */

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("nav.lookups") };
}

export default async function PrintLookupsPage() {
  const viewer = await requireCapability("lookups.manage");

  const [sets, t, common, words, locale] = await Promise.all([
    readLookupSets(viewer.tenantId),
    getTranslations("settings"),
    getTranslations("common"),
    getTranslations("lookups"),
    getLocale(),
  ]);

  /*
   * Every set's entries, read together rather than one screen at a time. The
   * screen behind this shows one set; the point of the sheet is that it is all
   * of them, so an office is not printing eleven pages one at a time.
   */
  const tables = await Promise.all(
    sets.map(async (set) => ({
      set,
      entries: await readLookupEntries(viewer.tenantId, set.set),
    })),
  );

  const digits = (value: number) => toLocaleDigits(String(value), locale);
  const total = sets.reduce((sum, set) => sum + set.total, 0);

  return (
    <PrintDocument
      tenantId={viewer.tenantId}
      title={t("nav.lookups")}
      subject={`${digits(sets.length)} ${words("set")} · ${digits(total)}`}
      backTo="/settings/lookups"
      backLabel={common("back")}
    >
      <div className="flex flex-col gap-8">
        {tables.map(({ set, entries }) => (
          /* Kept whole where it fits: a vocabulary split across a page break
             reads as two shorter vocabularies. */
          <section key={set.set} className="break-inside-avoid">
            {/* The set's own key, in Latin, exactly as the screen shows it:
                these are not translated — they are what the code reads. */}
            <h2 className="mb-2 text-base font-semibold">
              <span dir="ltr">{set.set}</span>
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                {digits(set.total)}
                {set.retired > 0 && ` · ${digits(set.retired)} ${words("retiredLabel")}`}
              </span>
            </h2>
            <PrintTable head={[words("label"), words("value"), words("status")]}>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <PrintCell>{entry.label}</PrintCell>
                  <PrintCell ltr>{entry.value}</PrintCell>
                  <PrintCell>{entry.retired ? words("retiredLabel") : words("offered")}</PrintCell>
                </tr>
              ))}
            </PrintTable>
          </section>
        ))}
      </div>
    </PrintDocument>
  );
}
