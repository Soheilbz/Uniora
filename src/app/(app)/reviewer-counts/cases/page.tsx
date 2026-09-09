import { ArrowRight, CalendarDays, ClipboardList, Scale, UsersRound } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PanelCard, StatCard } from "@/components/dashboard/panels";
import { PrintButton } from "@/components/engine/print-anchor";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { reviewerCases } from "@/modules/capacity/reviewers.ts";

/**
 * The cases behind one examiner's figure.
 *
 * ── Why this is a page and not a dialog ─────────────────────────────────────
 *
 * A count nobody can open is a count nobody argues with, and this office does
 * argue with these: a colleague who remembers examining four proposals and is
 * shown three wants the three. What settles that is a list read beside the
 * table it came from — one somebody can send to the person disputing it, and
 * print. A modal survives none of those.
 *
 * ── Why the examiner arrives as a name ──────────────────────────────────────
 *
 * Because that is what the tally keys on. The council's board is free text —
 * it appoints guest examiners who are in nobody's directory — so there is no id
 * to pass, and `reviewerCases` folds the name with the same function the tally
 * groups by. An examiner minuted «دکتر علی رضایی» and asked for as «علی رضایی»
 * gets the same list, which is the whole point of the fold.
 *
 * ── Both capabilities ───────────────────────────────────────────────────────
 *
 * `council.view` *and* `professors.view`, as an all-of, matching the register
 * this opens from and the report beside it: every row names a student out of
 * the decisions and an examiner out of the directory, and holding one without
 * the other opens a screen half of which cannot be shown.
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ reviewer?: string | string[] }>;
}) {
  const t = await getTranslations("reviewers");
  const name = named((await searchParams).reviewer);
  return { title: name ? t("working.title", { name }) : t("working.noReviewer") };
}

const MAX_REVIEWER_NAME_LENGTH = 300;

/** The examiner asked for, or nothing. A repeated parameter is not a name. */
function named(raw: string | string[] | undefined): string {
  const value = (typeof raw === "string" ? raw : "").trim();
  return value.length <= MAX_REVIEWER_NAME_LENGTH ? value : "";
}

export default async function ReviewerCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewer?: string | string[] }>;
}) {
  const viewer = await requireCapability("council.view", "professors.view");
  const name = named((await searchParams).reviewer);

  const [cases, lookups, t, common, nav, format, locale] = await Promise.all([
    reviewerCases(viewer.tenantId, name),
    lookupTable(viewer.tenantId, ["degrees", "decision_report_categories"]),
    getTranslations("reviewers"),
    getTranslations("common"),
    getTranslations("nav"),
    getFormatter(),
    getLocale(),
  ]);

  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  const heading = name ? t("working.title", { name }) : t("working.noReviewer");
  const examinationCases = cases.filter((one) => !one.isRepresentative);
  const representativeCases = cases.filter((one) => one.isRepresentative);
  const latestReview = cases.find((one) => one.meetingDate)?.meetingDate ?? null;

  return (
    <PageBody>
      <PageHeader
        title={heading}
        description={name ? t("working.description") : undefined}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: "/reviewer-counts" }, { label: heading }]}
        actions={
          <>
            <PrintButton label={common("print")} />
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href="/reviewer-counts">
                  {/* Mirrored under RTL: an arrow that means «back» points the
                      way the reader came, which is the other way here. */}
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                  {t("working.back")}
                </Link>
              }
            />
          </>
        }
      />

      {/*
       * Two empty states, not one.
       *
       * «No examiner was asked for» and «this examiner examined nothing» are
       * different facts, and the second is the one somebody has come here to
       * dispute. Collapsing them would answer a question about a name with a
       * sentence about a missing parameter.
       */}
      {!name ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Scale aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("working.noReviewer")}</EmptyTitle>
            <EmptyDescription>{t("working.noReviewerHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : cases.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Scale aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("working.empty")}</EmptyTitle>
            <EmptyDescription>{t("working.emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label={t("working.summary")}
          >
            <StatCard
              label={t("working.total")}
              value={format.number(cases.length)}
              hint={t("working.count", { count: cases.length })}
              icon={ClipboardList}
            />
            <StatCard
              label={t("working.examinations")}
              value={format.number(examinationCases.length)}
              hint={t("working.examinationsHint")}
              icon={UsersRound}
            />
            <StatCard
              label={t("working.representationsCount")}
              value={format.number(representativeCases.length)}
              hint={t("working.representationsHint")}
              icon={Scale}
            />
            <StatCard
              label={t("working.latestReview")}
              value={
                latestReview
                  ? format.dateTime(new Date(latestReview), { dateStyle: "medium" })
                  : "—"
              }
              hint={t("working.latestReviewHint")}
              icon={CalendarDays}
            />
          </section>

          <PanelCard
            title={t("working.caseList")}
            description={t("working.caseListHint")}
            action={
              <Badge variant="outline" className="shrink-0 font-normal">
                {t("working.count", { count: cases.length })}
              </Badge>
            }
          >
            <ul className="grid gap-3 md:grid-cols-2">
              {cases.map((one) => (
                <li
                  key={one.id}
                  className="group flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-border/80 bg-muted/10 p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/council-decisions/${one.id}`}
                        className="block break-words text-sm font-semibold underline-offset-4 group-hover:underline"
                      >
                        {one.studentName ?? common("notRecorded")}
                      </Link>
                      {one.studentNumber && (
                        <p className="numeric mt-1 text-xs text-muted-foreground" dir="ltr">
                          {toLocaleDigits(one.studentNumber, locale)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {one.educationLevel && (
                        <Badge variant="outline" className="font-normal">
                          {label("degrees", one.educationLevel)}
                        </Badge>
                      )}
                      {one.isRepresentative && (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {t("working.representative")}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="min-h-10 break-words text-sm leading-6 text-muted-foreground">
                    {one.thesisTitle ?? common("notRecorded")}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="font-normal">
                      {label("decision_report_categories", one.reportCategory) ??
                        common("notRecorded")}
                    </Badge>
                    <span className="numeric" dir="ltr">
                      {one.meetingNumber ? toLocaleDigits(one.meetingNumber, locale) : "—"}
                      {" · "}
                      {one.meetingDate
                        ? format.dateTime(new Date(one.meetingDate), { dateStyle: "medium" })
                        : "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </PanelCard>
        </div>
      )}
    </PageBody>
  );
}
