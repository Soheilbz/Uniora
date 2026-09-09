import { ArrowRight, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Pager } from "@/components/engine/pager";
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
import { parseIntegerParam } from "@/lib/input-limits.ts";
import { MAX_PAGE } from "@/lib/register/spec.ts";
import { requireModule } from "@/lib/viewer.ts";
import { RECONCILE_PAGE, readReconciliation } from "@/modules/capacity/queries.ts";

/**
 * Where the minutes and the student register disagree about a supervisor.
 *
 * ── Why the two are allowed to differ ───────────────────────────────────────
 *
 * The council's proposal decision *appointed* the team — it is the document a
 * supervisor would point at if a figure were disputed, and it is what the
 * capacity engine counts from. The student register's three supervisor columns
 * are the office's working copy, corrected as people change, with no record of
 * when or by whom.
 *
 * Neither is wrong to hold what it holds. But the figure is computed from one
 * and the office usually reads the other, so a disagreement is a question
 * somebody has to settle — and until they do, it is the likeliest explanation
 * for a capacity number that looks wrong.
 *
 * ── It reports and changes nothing ──────────────────────────────────────────
 *
 * There is no «fix» button and there should not be. Which side is right depends
 * on what actually happened — a supervisor stepped down, a minute was typed
 * wrong, a correction never reached the sitting — and that is not something
 * this screen can know. Writing either way on a guess would destroy the only
 * evidence of the disagreement.
 */

const BASE = "/professor-capacity";

export async function generateMetadata() {
  const t = await getTranslations("capacity");
  return { title: t("reconcile.title") };
}

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { viewer } = await requireModule(BASE);

  const asked = (await searchParams).page;
  const parsedPage = parseIntegerParam(asked);
  const page = parsedPage !== null && parsedPage > 0 ? Math.min(parsedPage, MAX_PAGE) : 1;

  const [found, t, common, nav, _format, locale] = await Promise.all([
    readReconciliation(viewer.tenantId, page),
    getTranslations("capacity"),
    getTranslations("common"),
    getTranslations("nav"),
    getFormatter(),
    getLocale(),
  ]);

  const seatLabel = (seat: string) => t(`seat${seat.charAt(0).toUpperCase()}${seat.slice(1)}`);

  return (
    <PageBody>
      <PageHeader
        title={t("reconcile.title")}
        description={t("reconcile.hint")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: BASE }, { label: t("reconcile.title") }]}
        actions={
          <>
            <PrintButton label={common("print")} />
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href={BASE}>
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                  {t("back")}
                </Link>
              }
            />
          </>
        }
      />

      {/* Said at the top, because a screen listing problems reads as a screen
          that fixes them unless it says otherwise. */}
      <p className="rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
        {t("reconcile.readOnly")}
      </p>

      {found.total === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitCompareArrows aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("reconcile.clean")}</EmptyTitle>
            <EmptyDescription>{t("reconcile.cleanHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <p className="numeric text-sm tabular-nums text-muted-foreground">
            {t("reconcile.count", { count: found.total })}
          </p>

          <ul className="flex flex-col divide-y rounded-md border">
            {found.rows.map((one) => (
              <li
                key={`${one.studentId}-${one.seat}`}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/students/${one.studentId}`}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {one.studentName}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {one.studentNumber && (
                      <span className="numeric" dir="ltr">
                        {toLocaleDigits(one.studentNumber, locale)}
                      </span>
                    )}
                    <Badge variant="outline" className="font-normal">
                      {seatLabel(one.seat)}
                    </Badge>
                    {one.source === "student_register" && (
                      <Badge className="border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground">
                        {t("reconcile.registerOnly")}
                      </Badge>
                    )}
                  </span>
                </div>

                {/*
                 * The two sides, named. Not a diff with one struck through:
                 * neither is «the old value», and drawing one that way would
                 * settle the question this screen exists to leave open.
                 */}
                <dl className="grid shrink-0 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted-foreground">
                    {one.source === "student_register"
                      ? t("reconcile.noMinutes")
                      : t("reconcile.minuted")}
                  </dt>
                  <dd>{one.minuted || <span className="text-muted-foreground">—</span>}</dd>
                  <dt className="text-muted-foreground">{t("reconcile.registered")}</dt>
                  <dd>
                    {one.registered ?? (
                      <span className="text-muted-foreground">{t("reconcile.none")}</span>
                    )}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>

          {/*
           * Paged, like every register here.
           *
           * A screen whose rows come from a computation rather than a query is
           * still a screen: unbounded it drew every disagreement in the archive
           * — on a decade's register that was 1,683 rows and 5.5 MB of markup,
           * of which one person read the first fifty.
           */}
          {found.pages > 1 && (
            <Pager
              page={found.page}
              pages={found.pages}
              total={found.total}
              shown={found.rows.length}
              size={RECONCILE_PAGE}
              sizes={[RECONCILE_PAGE]}
              sizeHrefFor={() => `${BASE}/reconcile`}
              hrefFor={(next) =>
                next <= 1 ? `${BASE}/reconcile` : `${BASE}/reconcile?page=${next}`
              }
            />
          )}
        </>
      )}
    </PageBody>
  );
}
