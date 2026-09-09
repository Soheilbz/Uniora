import { ArrowRight, Gauge, Layers3, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Figure, ProvisionalNotice } from "@/components/capacity/panels";
import { PrintButton } from "@/components/engine/print-anchor";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toLocaleDigits } from "@/lib/digits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireModule } from "@/lib/viewer.ts";
import type { TableExplanation } from "@/modules/capacity/engine.ts";
import { readCapacityFor } from "@/modules/capacity/queries.ts";

/**
 * The working behind one member's capacity figure.
 *
 * ── Why this is a page ──────────────────────────────────────────────────────
 *
 * A figure nobody can open is a figure nobody argues with, and this one decides
 * whether a colleague may take another student. What settles a dispute is the
 * arithmetic laid out beside the table it came from: the base row and its
 * citation, then every student charged against it, then the weight each was
 * charged at and the proviso that set that weight. All of it printable, because
 * the argument usually happens at a meeting.
 */

const BASE = "/professor-capacity";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const metaId = (await params).id;
  if (!isUuid(metaId)) notFound();
  const { viewer } = await requireModule(BASE);
  const { reading } = await readCapacityFor(viewer.tenantId, metaId);
  const t = await getTranslations("capacity");
  const who = reading.names.get(metaId);
  return { title: who ? t("detailsFor", { name: who.name }) : t("details") };
}

export default async function CapacityWorkingPage({ params }: { params: Promise<{ id: string }> }) {
  const { viewer } = await requireModule(BASE);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [{ reading, explanation }, lookups, t, common, nav, format, locale] = await Promise.all([
    readCapacityFor(viewer.tenantId, id),
    lookupTable(viewer.tenantId, ["academic_ranks"]),
    getTranslations("capacity"),
    getTranslations("common"),
    getTranslations("nav"),
    getFormatter(),
    getLocale(),
  ]);

  /* A member of staff who is not in the directory has no capacity to explain —
     that is a missing record, not an empty one. */
  if (!explanation) notFound();

  const who = reading.names.get(id) ?? { name: id, code: null };
  const figure = (value: number) => format.number(value, { maximumFractionDigits: 2 });
  const rankLabel = (value: string | null) =>
    value
      ? (lookups.get("academic_ranks")?.find((entry) => entry.value === value)?.label ?? value)
      : null;

  const heading = t("detailsFor", { name: who.name });

  /** One of the two tables, laid out as the sum it is. */
  const tableBlock = (table: TableExplanation) => (
    <section
      key={table.table}
      className="overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-2xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/25 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{table.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{table.citation}</p>
        </div>
        <Badge variant="outline" className="font-normal">
          {table.counted.length} {t("counted")}
        </Badge>
      </div>
      {table.base === null ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {t("noBaseHint")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-border/60 bg-border/60 sm:grid-cols-3 xl:grid-cols-6">
            <div className="bg-card px-4 py-3">
              <Figure value={table.allowance} label={t("allowance")} format={figure} />
            </div>
            <div className="bg-card px-4 py-3">
              <Figure value={table.used} label={t("used")} format={figure} />
            </div>
            <div className="bg-card px-4 py-3">
              <Figure
                value={table.remaining}
                label={t("remaining")}
                format={figure}
                {...(table.remaining !== null && table.remaining < 0
                  ? { tone: "over" as const }
                  : {})}
              />
            </div>
            <div className="bg-card px-4 py-3">
              <Figure
                value={table.internationalAllowance}
                label={t("international")}
                format={figure}
                tone="muted"
              />
            </div>
            <div className="bg-card px-4 py-3">
              <Figure
                value={table.internationalRemaining}
                label={t("internationalRemaining")}
                format={figure}
                tone="muted"
              />
            </div>
            <div className="bg-card px-4 py-3">
              <Figure value={table.ceiling} label={t("ceiling")} format={figure} tone="muted" />
            </div>
          </div>
          {table.lines.length > 0 && (
            <div className="border-b border-border/60 bg-muted/10 px-5 py-3">
              <p className="mb-2 text-xs font-semibold text-foreground/80">
                {t("calculationBasis")}
              </p>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {table.lines.map((line) => (
                  <li
                    key={`${table.table}-${line.citation}-${line.label}`}
                    className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 break-words">
                      {line.label} <span className="opacity-70">({line.citation})</span>
                    </span>
                    <span className="numeric shrink-0 font-medium tabular-nums text-foreground">
                      {figure(line.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {table.counted.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">{t("noCounted")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {table.counted.map((counted) => (
                <li
                  key={`${counted.studentId}-${counted.seat}`}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/20"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/students/${counted.studentId}`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {counted.studentName}
                    </Link>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {counted.studentNumber && (
                        <span className="numeric" dir="ltr">
                          {toLocaleDigits(counted.studentNumber, locale)}
                        </span>
                      )}
                      <Badge variant="outline" className="font-normal">
                        {t(`seat${counted.seat.charAt(0).toUpperCase()}${counted.seat.slice(1)}`)}
                      </Badge>
                      {counted.international && (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {t("international")}
                        </Badge>
                      )}
                      {counted.appointmentOnly && (
                        <Badge
                          variant="outline"
                          className="border-warning-subtle-border bg-warning-subtle text-warning-subtle-foreground"
                        >
                          {t("appointmentOnly")}
                        </Badge>
                      )}
                    </span>

                    {/*
                     * Why this student cost what they cost — one line per
                     * proviso, with its citation. «۰٫۲۵» on its own is a number
                     * somebody has to take on trust; «۱⁄۲ تبصره‌ی ۷ × ۱⁄۲
                     * تبصره‌ی ۸» is an argument they can check.
                     */}
                    {counted.steps.length > 0 && (
                      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                        {counted.steps.map((step) => (
                          <li key={step.citation}>
                            {step.label}
                            <span className="numeric mx-1">×{figure(step.factor)}</span>
                            <span className="opacity-70">({step.citation})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <span className="numeric rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold tabular-nums text-primary">
                    {figure(counted.weight)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );

  return (
    <PageBody>
      <PageHeader
        title={heading}
        description={t("detailsDescription")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title"), href: BASE }, { label: who.name }]}
        actions={
          <>
            <PrintButton label={common("print")} />
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link href={BASE}>
                  {/* Mirrored under RTL: «back» points the way the reader came,
                      which is the other way here. */}
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
                  {t("back")}
                </Link>
              }
            />
          </>
        }
      />

      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Gauge className="size-3.5" aria-hidden />
        {rankLabel(explanation.rank) ?? t("noBase")}
        <span aria-hidden>·</span>
        {t("regulation", {})}
      </p>

      {/* This member's own unknowns, not the regulation's whole list: the ones
          that actually touched a figure on this page. */}
      <ProvisionalNotice
        title={t("provisional")}
        hint={t("provisionalHint")}
        inputsLabel={t("missingInputs")}
        supplyLabel={t("supply")}
        inputs={explanation.missingInputs}
      />

      <section aria-label={t("detailsSummary")} className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: t("counted"),
            value: explanation.dissertation.counted.length + explanation.thesis.counted.length,
            icon: Users,
          },
          { label: t("excluded"), value: explanation.excluded.length, icon: Layers3 },
          { label: t("missingInputs"), value: explanation.missingInputs.length, icon: Gauge },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border border-border/80 bg-card/95 p-4 shadow-2xs"
          >
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="numeric text-2xl font-semibold tabular-nums">{figure(value)}</span>
            </span>
          </div>
        ))}
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        {tableBlock(explanation.dissertation)}
        {tableBlock(explanation.thesis)}
      </div>

      {/*
       * The students the regulation takes out of the count.
       *
       * Shown rather than omitted: «why is this one not in my five» has an
       * answer, and it is a proviso with a number on it.
       */}
      {explanation.excluded.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-warning/30 bg-card/95 shadow-2xs">
          <div className="border-b border-warning/20 bg-warning/5 px-5 py-4">
            <h2 className="text-base font-semibold">{t("excluded")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("excludedHint")}</p>
          </div>
          <ul className="flex flex-col divide-y rounded-md border">
            {explanation.excluded.map((one) => (
              <li
                key={one.studentId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-warning/5"
              >
                <Link
                  href={`/students/${one.studentId}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  {one.studentName}
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {one.label}
                  <Badge variant="outline" className="font-normal">
                    {one.citation}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageBody>
  );
}
