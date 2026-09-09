import { FileText, ListChecks, ScrollText } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { MinutesDocument } from "@/components/council/minutes-document";
import { sittingDate } from "@/components/council/paper";
import { SittingPicker } from "@/components/council/sitting-picker";
import { Notice } from "@/components/engine/notice";
import { PrintButton } from "@/components/engine/print-anchor";
import { type Crumb, PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import type { SearchParams } from "@/lib/register/params.ts";
import { requireModule } from "@/lib/viewer.ts";
import { COUNCIL_LOOKUP_SETS } from "@/modules/council/fields.ts";
import { readSittingPapers, readSittings } from "@/modules/council/papers.ts";
import { writesDissertation } from "@/modules/council/sittings.ts";
import { readInstitution } from "@/modules/settings/institution-queries.ts";

/**
 * The checklist the office carries into the sitting.
 *
 * ── A page with the sitting in its address ──────────────────────────────────
 *
 * `?meeting=۶۸۰`, so «چک‌لیست ۶۸۰» is a link the office can send, bookmark and
 * reload, and so the decisions register can reach it with the sitting already
 * chosen. The picker stays on screen and stays changeable, because comparing
 * two sittings is a real thing to want.
 *
 * Two panes: what you choose on one side, what the printer will produce on the
 * other. The document is laid out on true A4 sheets at the size it will print,
 * because a document laid out to the pane's width prints its page breaks
 * somewhere else, and the only way to see the real thing is to print it.
 */

export async function generateMetadata() {
  const t = await getTranslations("documents");
  return { title: t("minutes.title") };
}

const BASE = "/council-minutes";

export default async function CouncilMinutesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  /* The same capability the decisions register is guarded on: this is that
     register's paper, not a module of its own. */
  const { viewer } = await requireModule("/council-decisions");
  const params = await searchParams;
  const raw = Array.isArray(params.meeting) ? params.meeting[0] : params.meeting;
  const requestedMeeting = typeof raw === "string" && raw.trim().length <= 50 ? raw.trim() : "";

  const [sittings, t, common, nav, group, decisions, council, locale] = await Promise.all([
    readSittings(viewer.tenantId),
    getTranslations("documents"),
    getTranslations("common"),
    getTranslations("nav"),
    getTranslations("group"),
    getTranslations("decisions"),
    getTranslations("council"),
    getLocale(),
  ]);

  /* Only a meeting number from this tenant's own sitting list is allowed to
     drive the paper query. A hand-edited URL therefore becomes an empty
     selection rather than an arbitrary database predicate. */
  const chosen = sittings.some((sitting) => sitting.meetingNumber === requestedMeeting)
    ? requestedMeeting
    : "";

  const [papers, lookups, institution] = chosen
    ? await Promise.all([
        readSittingPapers(viewer.tenantId, chosen),
        lookupTable(viewer.tenantId, COUNCIL_LOOKUP_SETS),
        readInstitution(viewer.tenantId),
      ])
    : [null, null, null];

  const crumbs: Crumb[] = [
    { label: group("research") },
    { label: council("title"), href: "/council-meetings" },
    { label: decisions("title"), href: "/council-decisions" },
    { label: t("minutes.title") },
  ];

  const options = sittings.map((sitting) => ({
    value: sitting.meetingNumber,
    label: `${t("meetingOption", {
      number: toLocaleDigits(sitting.meetingNumber, locale),
      count: toLocaleDigits(String(sitting.items), locale),
    })}${sitting.meetingDate ? ` — ${toLocaleDigits(sittingDate(sitting.meetingDate), locale)}` : ""}`,
  }));

  const lookup = (set: string, value: string | null) =>
    value ? (lookups?.get(set)?.find((entry) => entry.value === value)?.label ?? value) : "";

  return (
    <PageBody className="print-page-body">
      {/*
       * Hidden on paper, all of it.
       */}
      <div data-print-hide>
        <PageHeader
          title={t("minutes.title")}
          description={t("minutes.subtitle")}
          breadcrumbLabel={nav("breadcrumb")}
          breadcrumbs={crumbs}
        />
      </div>

      {/* 2-col layout: left panel hidden on print, right panel (document) visible */}
      <div className="print-workspace grid min-h-0 gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div data-print-hide className="print-controls flex flex-col gap-4">
          {/* Document Switcher Tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/80 bg-muted/40 p-1">
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-card py-2 text-xs font-bold text-primary shadow-2xs">
              <ScrollText className="size-3.5" />
              <span>{t("minutes.title")}</span>
            </div>
            <Link
              href={`/council-checklist${chosen ? `?meeting=${encodeURIComponent(chosen)}` : ""}`}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-muted-foreground hover:bg-card/50 hover:text-foreground transition-all"
            >
              <ListChecks className="size-3.5" />
              <span>{t("checklist.title")}</span>
            </Link>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("pickMeeting")}</CardTitle>
              <CardDescription>{t("pickMeetingHint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SittingPicker
                sittings={options}
                selected={chosen}
                base={BASE}
                label={t("meeting")}
                placeholder={t("meeting")}
              />
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href="/council-meetings">{common("back")}</Link>}
              />
            </CardContent>
          </Card>

          {papers?.anything && (
            <div className="flex flex-col gap-1.5">
              <PrintButton
                label={common("print")}
                disabled={!institution?.name?.trim() || !institution?.faculty?.trim()}
              />
              {/* Says where the PDF comes from: the destination is a choice in
                  the system dialog, and nothing on screen said so. */}
              <p className="text-xs leading-relaxed text-muted-foreground">{t("printHint")}</p>
            </div>
          )}

          {/* Official council documents are blocked until the institutional
              identity required for the letterhead is complete. */}
          {chosen && (!institution?.name?.trim() || !institution?.faculty?.trim()) && (
            <Notice intent="warning" title={t("noInstitution")}>
              {t("noInstitutionHint")}
            </Notice>
          )}

          {chosen && !papers && <Notice intent="danger" title={t("noSuchSitting")} />}

          {papers && !papers.anything && <Notice intent="warning" title={t("noDecisions")} />}

          {/*
           * A case the document has no section for is nearly always a category
           * code the screens do not recognise — a wrongly imported sitting.
           * Saying so beats printing a short and plausible checklist.
           */}
          {papers && papers.sections.unfiled.length > 0 && (
            <Notice
              intent="warning"
              title={t("unfiled", {
                count: toLocaleDigits(String(papers.sections.unfiled.length), locale),
              })}
            >
              {t("unfiledHint")}
            </Notice>
          )}
        </div>

        {papers?.anything ? (
          <div className="print-document-container print-preview flex flex-col gap-6">
            <MinutesDocument
              papers={papers}
              words={{
                /*
                 * The heading names the faculty whose council it is, inside the
                 * line rather than above it. With no institution profile on
                 * file it is the council's name alone — which is what version 1
                 * prints when its own faculty name is missing.
                 */
                heading: institution?.faculty
                  ? t("minutes.headingOf", { faculty: institution.faculty })
                  : t("minutes.heading"),
                subheading: t("minutes.subheading"),
                ...(institution?.crest ? { crest: institution.crest } : {}),
                sectionA: t("minutes.sectionA"),
                sectionB: t("minutes.sectionB"),
                sectionC: t("minutes.sectionC"),
                sectionD: t("minutes.sectionD"),
                sectionDEmpty: t("minutes.sectionDEmpty"),
                letters: {
                  a: t("letter.a"),
                  b: t("letter.b"),
                  c: t("letter.c"),
                  d: t("letter.d"),
                },
                present: t("minutes.present"),
                absent: t("minutes.absent"),
                nobody: t("minutes.nobody"),
                signature: t("minutes.signature"),
                researchDeputy: decisions("field.researchDeputy"),
                doctor: t("doctor"),
                /* The minute's own field set — «تاریخ», «ساعت», «مکان». */
                details: {
                  number: decisions("field.meetingNumber"),
                  date: council("field.dateShort"),
                  time: council("field.timeShort"),
                  day: decisions("field.meetingDay"),
                  place: council("field.placeShort"),
                  weekday: lookup("weekdays", papers.meeting.meetingDay),
                },
                columns: [
                  t("minutes.row"),
                  decisions("field.studentName"),
                  decisions("field.studentNumber"),
                  decisions("field.educationLevel"),
                  decisions("field.fieldOfStudy"),
                  decisions("field.primarySupervisor"),
                  decisions("field.secondarySupervisor"),
                  decisions("field.thirdSupervisor"),
                ],
                seat: (key: string) => decisions(key),
                readable: (set: string | null, value: string | null) =>
                  (set ? lookup(set, value) : (value ?? "").trim()) || "…",
                separator: locale.toLowerCase().startsWith("fa") ? "، " : ", ",
                proposalSentence: (values) => t("minutes.itemProposal", { ...values }),
                defenceSentence: (values) => t("minutes.itemDefence", { ...values }),
                defenceWithInvited: (values) => t("minutes.itemDefenceInvited", { ...values }),
                standingIn: (person: string, member: string) =>
                  t("minutes.standingIn", { person, member }),
                /* The council's own nouns — see `writesDissertation`. */
                thesisNoun: (level: string | null) =>
                  writesDissertation(level) ? t("word.dissertation") : t("word.thesis"),
              }}
            />
          </div>
        ) : (
          <div data-print-hide>
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText aria-hidden />
                </EmptyMedia>
                {/*
                 * Not the picker's own words. This pane sat beside the picker
                 * card repeating its title and its hint verbatim — the same two
                 * sentences twice on one screen — which reads as a rendering
                 * fault rather than as an instruction. The card says how to
                 * choose; this says what will appear here once somebody has.
                 */}
                <EmptyTitle>{t("documentEmpty")}</EmptyTitle>
                <EmptyDescription>{t("documentEmptyHint")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
    </PageBody>
  );
}
