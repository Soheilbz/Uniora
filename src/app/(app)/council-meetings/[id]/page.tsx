import { CalendarX, ListChecks, Pencil, Scale, ScrollText, UserRound, Users } from "lucide-react";
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { entriesForDisplay, labelOf, lookupTable } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import { COUNCIL_LOOKUP_SETS } from "@/modules/council/fields.ts";
import { readMeeting, readMeetingBusiness } from "@/modules/council/queries.ts";

/**
 * One sitting: what it decided, who was there, and what it was.
 *
 * ── Why the business is one tab and not three ───────────────────────────────
 *
 * A sitting transacts three kinds of thing — decisions on students, rulings,
 * and supervision appointments — and they are three *groups within one tab*,
 * not three tabs. «What did جلسه ۶۸۰ decide» is one question. Split across
 * three tabs, answering it means opening all three and adding up, and two of
 * them are usually empty, so the reader learns to click through empty panels to
 * find the one panel that had anything in it.
 *
 * The tab strip carries the sitting's *aspects* instead: what it decided, who
 * attended, what it was, and who has edited the record. That is the same shape
 * the register uses, and the same shape every other record page
 * here uses — a strip of aspects, never a strip of one aspect's subdivisions.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule("/council-meetings");
  const meeting = await readMeeting(viewer.tenantId, metaId);
  const [t, locale] = await Promise.all([getTranslations("council"), getLocale()]);
  /* In the reader's numerals, like the heading on the page itself. A sitting
     number is stored ASCII because the council's documents join on it; the tab
     said «جلسه 678» while the record below it said «جلسه ۶۷۸». */
  return {
    title: meeting
      ? t("sitting", { number: toLocaleDigits(meeting.meetingNumber, locale) })
      : t("title"),
  };
}

export default async function MeetingRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule("/council-meetings");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const meeting = await readMeeting(viewer.tenantId, id);
  if (!meeting) notFound();

  const [business, lookups, locale, format, t, common, nav] = await Promise.all([
    readMeetingBusiness(viewer.tenantId, id),
    lookupTable(viewer.tenantId, COUNCIL_LOOKUP_SETS),
    getLocale(),
    getFormatter(),
    getTranslations("council"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const canManage = can(viewer, "council.manage");

  const canReadHistory = can(viewer, "audit.view");

  /*
   * Resolved here, not inside the JSX below.
   *
   * `await` inside the array handed to `RecordTabs` makes this panel stream as
   * its own chunk, and Base UI's tabs — which register on mount — ended up
   * holding two entries: two tabs reporting `aria-selected="true"`, two panels
   * on screen, and with the full component in place a re-render loop that took
   * the page down. Awaited up here, the array the client component receives is
   * an ordinary resolved value.
   */

  const history = canReadHistory
    ? await historyTab(viewer.tenantId, "council_meeting", meeting.id)
    : null;

  const label = (set: string, value: string | null) => labelOf(lookups, set, value);

  const chip = (set: string, value: string | null) => {
    if (!value) return <span className="text-muted-foreground">—</span>;
    const entries = entriesForDisplay(lookups, set, value);
    const index = entries.findIndex((entry) => entry.value === value);
    return (
      <Badge
        variant="outline"
        className={cn("font-normal", index >= 0 && TONES[index % TONES.length])}
      >
        {index >= 0 ? entries[index]?.label : value}
      </Badge>
    );
  };

  const sittingName = t("sitting", { number: toLocaleDigits(meeting.meetingNumber, locale) });

  const present = meeting.participants?.length ?? 0;
  const absent = meeting.absentees?.length ?? 0;
  const items = [...business.decisions, ...business.rulings, ...business.appointments];

  /*
   * Items whose own recorded date is not the sitting's.
   *
   * Counted rather than corrected. A decision filed by number before the
   * sitting record existed carries whatever date the typist had; the sitting
   * was then minuted for another day, and the two disagree honestly. Which one
   * is right is not something this page can know — so it says how many, and
   * somebody who does know opens them.
   *
   * Rows with no date of their own are not mismatches. «Not recorded» is not a
   * contradiction, and counting it as one would put a warning on nearly every
   * sitting.
   */
  const mismatched = business.meetingDate
    ? items.filter((item) => item.meetingDate && item.meetingDate !== business.meetingDate).length
    : 0;

  /** A list of names, as the minute prints them: in order, one per line. */
  const nameList = (names: string[] | null, emptyLabel: string) =>
    names && names.length > 0 ? (
      <ol className="flex flex-col gap-1">
        {names.map((name, index) => (
          <li key={name} className="flex gap-2 text-sm">
            {/* The position is part of the record — the minute prints them in
                this order — so it is shown rather than left implicit. */}
            <span className="numeric w-5 shrink-0 text-muted-foreground">
              {toLocaleDigits(String(index + 1), locale)}.
            </span>
            <span>{name}</span>
          </li>
        ))}
      </ol>
    ) : (
      <span className="text-muted-foreground">{emptyLabel}</span>
    );

  const emptyTab = (message: string) => (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Scale aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{message}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );

  /**
   * One kind of business, headed and counted.
   *
   * An empty group is dropped rather than shown with a «none» line: three
   * «بدون مصوبه» notices under three headings is a panel that reports nothing
   * three times. If *all* three are empty the tab says so once, below.
   */
  const group = (title: string, count: number, body: React.ReactNode) =>
    count === 0 ? null : (
      <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card/45 p-3 shadow-2xs sm:p-4">
        <h2 className="flex items-center gap-2 rounded-xl bg-primary/8 px-3 py-2 text-sm font-semibold text-primary dark:bg-primary/15">
          {title}
          <span className="numeric rounded-full bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary dark:bg-primary/20">
            {format.number(count)}
          </span>
        </h2>
        {body}
      </section>
    );

  return (
    <PageBody>
      <PageHeader
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/council-meetings" }, { label: sittingName }]}
      />

      <RecordHeader
        name={sittingName}
        secondary={meeting.meetingLocation}
        identifier={
          meeting.meetingDate
            ? format.dateTime(new Date(meeting.meetingDate), { dateStyle: "long" })
            : null
        }
        standing={
          meeting.meetingDay ? (
            <Badge variant="outline" className="font-normal">
              {label("weekdays", meeting.meetingDay)}
            </Badge>
          ) : null
        }
        actions={
          <>
            {/*
             * The document page with this sitting already chosen, rather than a
             * minute nested under the record. One address produces the minute —
             * the decisions register reaches the same page with nothing chosen
             * — so «صورت‌جلسه ۶۸۰» is one link wherever it was opened from, and
             * the picker is still there to compare it with ۶۷۹.
             */}
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/council-minutes?meeting=${encodeURIComponent(meeting.meetingNumber)}`}
                >
                  <ScrollText className="size-4" aria-hidden />
                  {t("minutes")}
                </Link>
              }
            />
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/council-checklist?meeting=${encodeURIComponent(meeting.meetingNumber)}`}
                >
                  <ListChecks className="size-4" aria-hidden />
                  {t("checklist")}
                </Link>
              }
            />
            <PrintButton label={common("print")} />
            {canManage && (
              <Button
                nativeButton={false}
                render={
                  <Link href={`/council-meetings/${meeting.id}/edit`}>
                    <Pencil className="size-4" aria-hidden />
                    {common("edit")}
                  </Link>
                }
              />
            )}
          </>
        }
      />

      {/*
       * The three counts that describe a sitting, on one line under its name.
       *
       * Attendance and business are the two things anybody checks first —
       * whether the sitting was quorate and how much it got through — and both
       * otherwise live inside tabs that have to be opened to be read.
       */}
      <p className="text-sm text-muted-foreground">
        {t("record.summary", { present, absent, business: items.length })}
      </p>

      <RecordTabs
        tabs={[
          {
            value: "business",
            label: t("record.business"),
            content: (
              <div className="flex flex-col gap-6">
                {/*
                 * Said once, above the groups, because it is about the panel as
                 * a whole rather than about any one item in it.
                 */}
                {mismatched > 0 && (
                  <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning-foreground">
                    <CalendarX className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{t("record.dateMismatch", { count: mismatched })}</span>
                  </p>
                )}

                {items.length === 0 && emptyTab(t("noBusiness"))}

                {group(
                  t("tab.decisions"),
                  business.decisions.length,
                  <ul className="grid gap-3 md:grid-cols-2">
                    {business.decisions.map((decision) => (
                      <li
                        key={decision.id}
                        className="min-w-0 rounded-xl border border-border/80 bg-card shadow-2xs transition-colors hover:border-primary/35 hover:bg-primary/3"
                      >
                        <Link
                          href={`/council-decisions/${decision.id}`}
                          className="flex h-full min-w-0 flex-col gap-2 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <span className="min-w-0 text-sm font-semibold leading-7 text-foreground">
                            {decision.thesisTitle}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{decision.studentName}</span>
                            {decision.studentNumber && (
                              <span className="numeric" dir="ltr">
                                {toLocaleDigits(decision.studentNumber, locale)}
                              </span>
                            )}
                          </span>
                          <span className="mt-auto flex flex-wrap gap-2 pt-1">
                            {chip("decision_report_categories", decision.reportCategory)}
                            {chip("council_review_statuses", decision.reviewStatus)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>,
                )}

                {group(
                  t("tab.rulings"),
                  business.rulings.length,
                  <ul className="grid gap-3 md:grid-cols-2">
                    {business.rulings.map((ruling) => (
                      <li
                        key={ruling.id}
                        className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-2xs"
                      >
                        <span className="text-sm font-medium leading-7 text-foreground">
                          {ruling.decisionText}
                        </span>
                        <span className="mt-auto flex flex-wrap gap-2">
                          {chip("ruling_report_categories", ruling.reportCategory)}
                          {chip("council_review_statuses", ruling.reviewStatus)}
                        </span>
                      </li>
                    ))}
                  </ul>,
                )}

                {group(
                  t("tab.appointments"),
                  business.appointments.length,
                  <ul className="grid gap-3 md:grid-cols-2">
                    {business.appointments.map((appointment) => (
                      <li
                        key={appointment.id}
                        className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-2xs"
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                          <UserRound className="size-4 text-muted-foreground" aria-hidden />
                          <span className="font-semibold">{appointment.studentName}</span>
                          {appointment.studentNumber && (
                            <span className="numeric text-xs text-muted-foreground" dir="ltr">
                              {toLocaleDigits(appointment.studentNumber, locale)}
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Users className="size-3.5" aria-hidden />
                          {label("degrees", appointment.educationLevel)}
                          {appointment.fieldOfStudy && (
                            <>· {label("fields_of_study", appointment.fieldOfStudy)}</>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>,
                )}
              </div>
            ),
          },
          {
            value: "attendance",
            label: t("group.attendance"),
            content: (
              <RecordSection
                title={t("group.attendance")}
                description={t("section.attendanceHint")}
              >
                <RecordField label={`${t("present")} (${format.number(present)})`}>
                  {nameList(meeting.participants, t("nobody"))}
                </RecordField>
                <RecordField label={`${t("absent")} (${format.number(absent)})`}>
                  {nameList(meeting.absentees, t("nobody"))}
                </RecordField>
              </RecordSection>
            ),
          },
          {
            value: "sitting",
            label: t("group.sitting"),
            content: (
              <div className="flex flex-col gap-6">
                <RecordSection title={t("group.sitting")} description={t("section.sittingHint")}>
                  <RecordField label={t("field.meetingNumber")}>
                    {toLocaleDigits(meeting.meetingNumber, locale)}
                  </RecordField>
                  <RecordField label={t("field.meetingDate")}>
                    {meeting.meetingDate
                      ? format.dateTime(new Date(meeting.meetingDate), { dateStyle: "long" })
                      : null}
                  </RecordField>
                  <RecordField label={t("field.meetingTime")}>
                    {/* In the reader's numerals, like the sitting number above
                        it and like the same clock on the register. The printed
                        minute keeps ASCII — see `paper.tsx`; that is the
                        university's filed format, not this screen's. */}
                    {meeting.meetingTime ? toLocaleDigits(meeting.meetingTime, locale) : null}
                  </RecordField>
                  <RecordField label={t("field.meetingDay")}>
                    {label("weekdays", meeting.meetingDay)}
                  </RecordField>
                  <RecordField label={t("field.meetingLocation")}>
                    {meeting.meetingLocation}
                  </RecordField>
                  <RecordField label={t("field.researchDeputy")}>
                    {meeting.researchDeputy}
                  </RecordField>
                </RecordSection>

                {/*
                 * The minute's own notes, filed with the sitting's particulars
                 * rather than given a tab of their own — a tab that is empty on
                 * most sittings is a tab somebody opens for nothing.
                 */}
                <RecordSection title={t("group.record")} description={t("section.recordHint")}>
                  <RecordField label={t("field.notes")}>
                    {meeting.notes ? (
                      /* `whitespace-pre-line`: the notes are minuted line by
                         line, and each line is a clause. Collapsed, they become
                         one paragraph. */
                      <span className="whitespace-pre-line">{meeting.notes}</span>
                    ) : null}
                  </RecordField>
                </RecordSection>
              </div>
            ),
          },
          /*
           * Who changed what, and when — only for a reader of the trail.
           *
           * The tab is dropped rather than shown empty. `audit.view` is a real
           * permission, because the log names every colleague's edits, and a
           * tab that is always there but never has anything in it reads as a
           * broken screen rather than as a closed door.
           */
          ...(history ? [history] : []),
        ]}
      />
    </PageBody>
  );
}
