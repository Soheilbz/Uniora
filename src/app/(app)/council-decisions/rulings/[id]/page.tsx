import { ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/engine/print-anchor";
import { RecordField, RecordSection } from "@/components/engine/record-detail";
import { RecordHeader } from "@/components/engine/record-header";
import { historyTab } from "@/components/engine/record-history";
import { RecordTabs } from "@/components/engine/record-tabs";
import { TONES } from "@/components/engine/tones.ts";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { labelOf, lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import { COUNCIL_LOOKUP_SETS } from "@/modules/council/fields.ts";
import { readRuling } from "@/modules/council/registers.ts";

/**
 * One ruling: something the council resolved that names no student.
 *
 * Two groups and no checklist. A ruling is a sitting, a category, an outcome and
 * a paragraph of text — giving it the dossier's nine groups would be nine tabs
 * of which seven are empty, which is what the register avoids by
 * describing a ruling with its own two.
 *
 * The trail is the third, on the same terms as everywhere else: a record whose
 * text can be edited after a sitting has resolved it is exactly the kind that
 * somebody eventually has to ask «who changed this» about.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule("/council-decisions");
  const ruling = await readRuling(viewer.tenantId, metaId);
  const words = await getTranslations("rulings");
  return { title: ruling?.decisionText?.slice(0, 60) ?? words("title") };
}

export default async function RulingRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule("/council-decisions");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const ruling = await readRuling(viewer.tenantId, id);
  if (!ruling) notFound();

  const [lookups, locale, format, t, words, common, nav] = await Promise.all([
    lookupTable(viewer.tenantId, COUNCIL_LOOKUP_SETS),
    getLocale(),
    getFormatter(),
    getTranslations("decisions"),
    /*
     * `t` for the field labels, which the three registers share, and `words`
     * for what *this* register is called — the same split the appointment
     * record makes. Bound to «council» it said «جلسات شورا» in the breadcrumb
     * and again as the fallback name, so a ruling with no text yet read as
     * though the sitting were the record being looked at.
     */
    getTranslations("rulings"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const canManage = can(viewer, "council.manage");

  /*
   * Awaited here rather than inside the array handed to `RecordTabs` — an
   * `await` in there makes the panel stream as its own chunk, and Base UI's
   * tabs register on mount, so the strip ends up holding the entry twice. The
   * sitting record carries the same note and the same fix.
   */
  const history = can(viewer, "audit.view")
    ? await historyTab(viewer.tenantId, "council_ruling", ruling.id)
    : null;

  const entries = lookups.get("council_review_statuses") ?? [];
  const statusIndex = entries.findIndex((entry) => entry.value === ruling.reviewStatus);
  const label = (set: string, value: string | null) => labelOf(lookups, set, value);

  /*
   * The ruling's own text is its name — there is nothing else to call it.
   *
   * A ruling with no text yet falls back to its own register's word rather than
   * to the sitting's number, which would read as though the *sitting* were the
   * record being looked at.
   */
  const name = ruling.decisionText ?? words("title");

  return (
    <PageBody>
      <PageHeader
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: words("title"), href: "/council-decisions?tab=rulings" },
          /*
           * A ruling's name is a whole sentence — «سقف داوری هر عضو هیئت علمی در
           * هر نیم‌سال شش پرونده تعیین شد.» — so the trail carries an opening of
           * it rather than the whole thing, which would push the crumbs off the
           * line. The header below states it in full.
           */
          { label: name.length > 48 ? `${name.slice(0, 48)}…` : name },
        ]}
      />

      <RecordHeader
        name={name}
        identifier={toLocaleDigits(ruling.meetingNumber, locale)}
        secondary={
          ruling.meetingDate
            ? format.dateTime(new Date(ruling.meetingDate), { dateStyle: "long" })
            : null
        }
        standing={
          statusIndex >= 0 ? (
            <Badge
              variant="outline"
              className={cn("font-normal", TONES[statusIndex % TONES.length])}
            >
              {entries[statusIndex]?.label}
            </Badge>
          ) : null
        }
        actions={
          <>
            {ruling.meetingId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={`/council-meetings/${ruling.meetingId}`}>
                    <ExternalLink className="size-4" aria-hidden />
                    {t("openMeeting")}
                  </Link>
                }
              />
            )}
            <PrintButton label={common("print")} />
            {canManage && (
              <Button
                nativeButton={false}
                render={
                  <Link href={`/council-decisions/rulings/${ruling.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    {common("edit")}
                  </Link>
                }
              />
            )}
          </>
        }
      />

      <RecordTabs
        tabs={[
          {
            value: "meeting",
            label: t("group.meeting"),
            content: (
              <RecordSection title={t("group.meeting")} description={t("section.meetingHint")}>
                <RecordField label={t("field.meetingNumber")}>
                  {toLocaleDigits(ruling.meetingNumber, locale)}
                </RecordField>
                <RecordField label={t("field.meetingDate")}>
                  {ruling.meetingDate
                    ? format.dateTime(new Date(ruling.meetingDate), { dateStyle: "long" })
                    : null}
                </RecordField>
                <RecordField label={t("field.meetingTime")}>
                  {ruling.meetingTime ? toLocaleDigits(ruling.meetingTime, locale) : null}
                </RecordField>
                <RecordField label={t("field.meetingDay")}>
                  {label("weekdays", ruling.meetingDay)}
                </RecordField>
                <RecordField label={t("field.meetingLocation")}>
                  {ruling.meetingLocation}
                </RecordField>
                <RecordField label={t("field.reportCategory")}>
                  {label("ruling_report_categories", ruling.reportCategory)}
                </RecordField>
              </RecordSection>
            ),
          },
          {
            value: "text",
            label: t("group.text"),
            content: (
              <RecordSection title={t("group.text")} description={t("section.textHint")}>
                <RecordField label={t("field.decisionText")}>
                  {/* `whitespace-pre-line`: a ruling is minuted line by line and
                      each line is a clause. Collapsed, they become one
                      paragraph. */}
                  <span className="whitespace-pre-line">{ruling.decisionText}</span>
                </RecordField>
                <RecordField label={t("field.decisionDescription")}>
                  <span className="whitespace-pre-line">{ruling.decisionDescription}</span>
                </RecordField>
              </RecordSection>
            ),
          },
          /* Dropped rather than shown empty, without `audit.view` — the log
             names every colleague's edits, and a tab that is always there but
             never holds anything reads as a broken screen, not a closed door. */
          ...(history ? [history] : []),
        ]}
      />
    </PageBody>
  );
}
