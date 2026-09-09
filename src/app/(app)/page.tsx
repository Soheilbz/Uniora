import { CalendarDays, GraduationCap, Inbox, Plus, Scale, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AdmissionsChart, DegreeMix, PanelCard, StatCard } from "@/components/dashboard/panels";
import { Notice } from "@/components/engine/notice";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { can } from "@/lib/capabilities.ts";
import { toLocaleDigits } from "@/lib/digits.ts";
import { isTenantFeatureEnabled } from "@/lib/features.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { requireViewer } from "@/lib/viewer.ts";
import { DEFENCE_HORIZON_DAYS, dashboardCounts, RECENT_DAYS } from "@/modules/dashboard/queries.ts";
import { hasActivePortalLink } from "@/modules/portal/queries.ts";
import { readInstitution } from "@/modules/settings/institution-queries.ts";

/**
 * The landing screen.
 *
 * Four figures, two charts, the latest decisions, what needs acting on, and the
 * shortcuts — in the order and the two-column shape the application
 * uses, because the office reads this screen every morning and the layout is
 * already in their hands.
 */

export default async function DashboardPage() {
  const viewer = await requireViewer();

  /* A self-service identity with no administrative capability belongs in the
     bounded portal UX, not in an empty administrative dashboard. Hybrid users
     retain this dashboard and may open the portal explicitly. */
  if (
    viewer.capabilities.length === 0 &&
    (await isTenantFeatureEnabled(viewer.tenantId, "portals")) &&
    (await hasActivePortalLink(viewer))
  ) {
    redirect("/portal");
  }

  const [counts, institution, lookups, t, nav, students, professors, format, locale] =
    await Promise.all([
      dashboardCounts(viewer.tenantId),
      readInstitution(viewer.tenantId),
      lookupTable(viewer.tenantId, ["degrees"]),
      getTranslations("dashboard"),
      getTranslations("nav"),
      getTranslations("students"),
      getTranslations("professors"),
      getFormatter(),
      getLocale(),
    ]);

  const canAddStudents = can(viewer, "students.view", "students.manage");
  const canAddProfessors = can(viewer, "professors.view", "professors.manage");
  const canSeeCouncil = can(viewer, "council.view");
  const canManageInstitution = can(viewer, "institution.manage");

  /*
   * A figure, or the mark that says it was not counted.
   *
   * `?? 0` here would turn "the database did not answer" into «۰ شاغل به
   * تحصیل» — an assertion that the register is empty, made on the office's
   * landing screen, on the strength of a failed read.
   */
  const figure = (value: number | null) => (value === null ? "—" : format.number(value));

  /*
   * What the office should look at, as one ordered list.
   *
   * Built here rather than in the query because the *wording* is a property of
   * this screen and the counts are a property of the register. Ordered by how
   * quickly each goes stale: a defence in three weeks stops being actionable
   * the day it happens, a dossier waiting on the council can wait another week,
   * and a student without a supervisor has been in that state for months.
   */
  const signals = [
    {
      kind: "defencesSoon" as const,
      count: counts.defencesSoon,
      label: t("defencesSoon"),
      hint: t("defencesSoonHint", { days: figure(DEFENCE_HORIZON_DAYS) }),
      href: "/council-decisions",
    },
    {
      kind: "pendingReview" as const,
      count: counts.pendingReview,
      label: t("pendingReview"),
      /* The age of the oldest is what turns a queue into a problem: «۱۲ مورد»
         from last week's sitting and «۱۲ مورد» one of which has waited six
         months are the same number and not the same situation. */
      hint:
        counts.pendingOldestDays === null
          ? t("pendingReviewHint")
          : t("pendingOldest", { days: figure(counts.pendingOldestDays) }),
      href: "/council-decisions?status=pending",
    },
    {
      kind: "unsupervised" as const,
      count: counts.unsupervised,
      label: t("unsupervised"),
      hint: t("unsupervisedHint"),
      href: "/students?status=enrolled",
    },
  ];

  const jalaliYear = (iso: string) =>
    format.dateTime(new Date(iso), { year: "numeric" }).replace(/[^\d۰-۹]/g, "");

  /*
   * An institution with nothing on file yet gets one sentence, not four zeros.
   *
   * The alternative — which is what this screen did — is the whole dashboard
   * rendered against an empty register: four «۰», two blank charts, three
   * panels saying nothing was found and a shortcut list. Every one of those is
   * individually correct and together they read as software that is broken
   * rather than as an institution that has not started.
   *
   * All three counts, not one: an office that has entered its professors and no
   * students has begun, and the figures are then telling it something true.
   * `null` is a failed read and is deliberately not nought — a screen that
   * greeted a database outage with «add your first student» would be inviting
   * somebody to retype a register that is still there.
   */
  const nothingOnFile = counts.students === 0 && counts.professors === 0 && counts.decisions === 0;

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbLabel={nav("breadcrumb")}
        actions={
          canAddStudents ? (
            <Button
              nativeButton={false}
              render={
                <Link href="/students/new">
                  <Plus className="size-4" aria-hidden />
                  {t("shortcutStudentAction")}
                </Link>
              }
            />
          ) : null
        }
      />

      {/*
       * ── The two standing warnings, and what is deliberately not one ────────
       *
       * An unnamed institution first: it is on every printed instrument the
       * office issues, it is one field, and it is closed for good by filling it
       * in.
       *
       * Then the review queue, which is the office's own backlog and the
       * question somebody opening this screen is most often here to answer.
       *
       * «Students with no supervisor» is intentionally not a band.
       * It is a standing figure that no single morning's work moves — the
       * number that leaves it each week is the number a new intake puts back —
       * so a bar carrying it is a bar that is there every morning, and a bar
       * that is always there is a bar nobody reads. It is a row on the panel
       * below instead, which is exactly the distinction the attention rules
       * draw between `raised` and merely listed. Warning about it here while
       * the bell deliberately stays quiet about it was the two surfaces
       * disagreeing about the same fact.
       */}
      {canManageInstitution && !institution.name && (
        <Notice intent="warning" title={t("institutionUnsetTitle")}>
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1">{t("institutionUnsetBody")}</span>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/settings/institution">{t("institutionUnsetAction")}</Link>}
            />
          </span>
        </Notice>
      )}

      {counts.pendingReview !== null && counts.pendingReview > 0 && (
        <Notice intent="warning" title={t("pendingTitle", { count: counts.pendingReview })}>
          <span className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1">
              {counts.pendingOldestMeeting !== null && counts.pendingOldestDays !== null
                ? t("pendingOldestFull", {
                    /* The sitting number in the reader's numerals — it is stored
                       ASCII because the council's documents join on it, and
                       «جلسه 680» beside «۱۱۰ روز» is the one figure on this
                       banner that was left raw. */
                    meeting: toLocaleDigits(counts.pendingOldestMeeting, locale),
                    days: counts.pendingOldestDays,
                  })
                : null}
            </span>
            {canSeeCouncil && (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/council-decisions">{t("reviewDecisions")}</Link>}
              />
            )}
          </span>
        </Notice>
      )}

      {nothingOnFile ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyHint")}</EmptyDescription>
          </EmptyHeader>
          {/* The two acts that start a register, offered only to somebody who
              may perform them — a button that leads to a refusal is worse than
              no button. */}
          {(canAddStudents || canAddProfessors) && (
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                {canAddStudents && (
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/students/new">{students("add")}</Link>}
                  />
                )}
                {canAddProfessors && (
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/professors/new">{professors("add")}</Link>}
                  />
                )}
              </div>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <section aria-label={t("overview")}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t("enrolled")}
                value={figure(counts.enrolled)}
                hint={
                  counts.students === null
                    ? undefined
                    : t("enrolledHint", { count: counts.students })
                }
                icon={GraduationCap}
              />
              <StatCard
                label={t("activeProfessors")}
                value={figure(counts.professors)}
                hint={
                  counts.professors === null
                    ? undefined
                    : t("professorsHint", { count: counts.professors })
                }
                icon={UserRound}
              />
              <StatCard
                label={t("decisions")}
                value={figure(counts.decisions)}
                hint={
                  counts.firstDecisionDate
                    ? t("decisionsHint", { year: jalaliYear(counts.firstDecisionDate) })
                    : undefined
                }
                icon={Scale}
              />
              <StatCard
                label={t("recentMeetings")}
                value={figure(counts.recentMeetings)}
                hint={t("lastDays", { days: RECENT_DAYS })}
                icon={CalendarDays}
              />
            </div>
          </section>

          {/*
           * The body: the wide column carries what is read, the 360px rail carries
           * what is acted on. The rail drops beneath the body below `lg` rather than
           * squeezing, because a 360px panel at 400px wide is not a rail.
           */}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-w-0 flex-col gap-4">
              <PanelCard title={t("admissions")}>
                <AdmissionsChart
                  years={counts.admissions ?? []}
                  labelFor={(value) => toLocaleDigits(String(value), locale)}
                  caption={t("admissionsCaption")}
                  emptyLabel={counts.admissions === null ? t("unreadable") : t("admissionsEmpty")}
                />
              </PanelCard>

              <PanelCard title={t("degreeMix")}>
                <DegreeMix
                  slices={counts.degrees ?? []}
                  labelFor={(value) =>
                    lookups.get("degrees")?.find((entry) => entry.value === value)?.label ?? value
                  }
                  formatNumber={(value) => format.number(value)}
                  emptyLabel={counts.degrees === null ? t("unreadable") : t("degreeMixEmpty")}
                />
              </PanelCard>

              <PanelCard
                title={t("recentDecisions")}
                action={
                  canSeeCouncil ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={<Link href="/council-decisions">{t("allDecisions")}</Link>}
                    />
                  ) : null
                }
              >
                {counts.recent === null ? (
                  <p className="text-sm text-muted-foreground">{t("unreadable")}</p>
                ) : counts.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noDecisions")}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border/50">
                    {counts.recent.map((decision) => (
                      <li
                        key={decision.id}
                        className="group flex flex-col gap-1.5 py-3 transition-colors first:pt-0 last:pb-0"
                      >
                        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                          {decision.thesisTitle}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {decision.meetingNumber && (
                            <span className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 font-medium text-foreground/80">
                              {/*
                               * In the reader's numerals, like the sitting panel
                               * in the rail beside it. A sitting number is stored
                               * ASCII on purpose — the council's two documents
                               * *join* on it, and «۶۸۰» and «680» would be two
                               * sittings — so it has to be localised on the way
                               * out. `toLocaleDigits` rather than an ICU number,
                               * because «۶۸۱ (فوق‌العاده)» is not a number.
                               */}
                              {t("meeting", {
                                number: toLocaleDigits(decision.meetingNumber, locale),
                              })}
                            </span>
                          )}
                          {decision.studentName && (
                            <span className="font-medium text-foreground/90">
                              {decision.studentName}
                            </span>
                          )}
                          {decision.meetingDate && (
                            <span className="numeric text-muted-foreground">
                              {format.dateTime(new Date(decision.meetingDate), {
                                dateStyle: "medium",
                              })}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelCard>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              {/*
               * The last sitting, because it is the first question anybody opening
               * this screen asks. Read from the sittings register rather than from
               * the decisions minuted at it — a sitting that adjourned without a
               * resolution is still the last sitting.
               */}
              <PanelCard
                title={t("lastSitting")}
                action={
                  canSeeCouncil && counts.lastSitting ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link
                          href={`/council-meetings/${counts.lastSitting.id}`}
                          className="text-primary hover:text-primary/80"
                        >
                          {t("openSitting")}
                        </Link>
                      }
                    />
                  ) : null
                }
              >
                {counts.lastSitting === null ? (
                  <p className="text-sm text-muted-foreground">
                    {counts.students === null ? t("unreadable") : t("lastSittingEmpty")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 rounded-xl bg-muted/20 p-3.5 border border-border/40">
                    <p className="text-base font-bold text-foreground">
                      {counts.lastSitting.number
                        ? t("sittingNumber", {
                            number: toLocaleDigits(counts.lastSitting.number, locale),
                          })
                        : t("lastSitting")}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      {counts.lastSitting.date && (
                        <span className="numeric rounded-md bg-background px-2 py-0.5 border border-border/50 font-medium text-foreground">
                          {format.dateTime(new Date(counts.lastSitting.date), {
                            dateStyle: "long",
                          })}
                        </span>
                      )}
                      {counts.lastSitting.location && <span>{counts.lastSitting.location}</span>}
                      <span className="font-medium text-foreground/80">
                        {counts.lastSitting.decisions === 0
                          ? t("sittingNoDecisions")
                          : t("sittingDecisions", {
                              count: figure(counts.lastSitting.decisions),
                            })}
                      </span>
                    </div>
                  </div>
                )}
              </PanelCard>

              <PanelCard title={t("needsAttention")}>
                {/*
                 * Three signals, each hiding itself when it is nought.
                 *
                 * A panel that listed every signal with a zero beside it would be a
                 * panel nobody scans — the whole value of «موردی برای رسیدگی نیست»
                 * is that it is only true when all of them are. A signal that could
                 * not be *read* is a different case and stays visible, because
                 * silently omitting it would report an all-clear the application
                 * cannot vouch for.
                 */}
                {signals.every((signal) => signal.count === 0) ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <span className="size-2 rounded-full bg-success" />
                    <p>{t("nothingPending")}</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {signals
                      .filter((signal) => signal.count !== 0)
                      .map((signal) => (
                        <li key={signal.kind}>
                          <Link
                            href={signal.href}
                            className="group flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 p-3 transition-all hover:border-primary/40 hover:bg-muted/40 hover:shadow-2xs"
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                                {signal.label}
                              </span>
                              <span className="text-xs text-muted-foreground">{signal.hint}</span>
                            </span>
                            <span className="numeric shrink-0 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-bold text-primary tabular-nums">
                              {signal.count === null ? "—" : figure(signal.count)}
                            </span>
                          </Link>
                        </li>
                      ))}
                  </ul>
                )}
              </PanelCard>

              <PanelCard title={t("shortcuts")}>
                <ul className="flex flex-col gap-1.5">
                  {[
                    {
                      href: "/students/new",
                      label: t("shortcutStudentAction"),
                      hint: t("shortcutStudent"),
                      allowed: canAddStudents,
                    },
                    {
                      href: "/professors",
                      label: nav("professors"),
                      hint: t("shortcutProfessor"),
                      allowed: can(viewer, "professors.view"),
                    },
                    {
                      href: "/council-decisions",
                      label: nav("councilDecisions"),
                      hint: t("shortcutDecision"),
                      allowed: canSeeCouncil,
                    },
                  ]
                    // A shortcut to a screen this person cannot open is a dead end
                    // dressed as an invitation.
                    .filter((shortcut) => shortcut.allowed)
                    .map((shortcut) => (
                      <li key={shortcut.href}>
                        <Link
                          href={shortcut.href}
                          className="group flex flex-col gap-0.5 rounded-lg border border-transparent p-2.5 transition-all hover:border-border/60 hover:bg-muted/30"
                        >
                          <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                            {shortcut.label}
                          </span>
                          <span className="text-xs text-muted-foreground">{shortcut.hint}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </PanelCard>
            </div>
          </div>
        </>
      )}
    </PageBody>
  );
}
