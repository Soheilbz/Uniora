import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/engine/print-anchor";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame the six report screens hang in.
 *
 * ── Why a report is not a nav entry ─────────────────────────────────────────
 *
 * Each of these is *about* a register and is reached from it. There is no
 * «گزارش‌ها» in the sidebar and no screen that asks "which report" first: the
 * question an office has is always already about a particular register, and a
 * top-level index would put a choice in front of an answer they already know.
 *
 * They are routes rather than dialogs because every one is something somebody
 * sends to a colleague, opens in a second tab beside the register, bookmarks
 * and prints.
 *
 * ── The way back is a link, not history ─────────────────────────────────────
 *
 * A report is bookmarkable, and whoever opens the bookmark has no history to go
 * back through.
 */
export function ReportPage({
  title,
  description,
  back,
  backLabel,
  breadcrumbs,
  breadcrumbLabel,
  period,
  printLabel,
  children,
}: {
  title: string;
  description: string;
  /** The register this report is about. */
  back: string;
  backLabel: string;
  breadcrumbs: { label: string; href?: string }[];
  breadcrumbLabel: string;
  /** The year filter, where the report has one. */
  period?: ReactNode;
  printLabel: string;
  children: ReactNode;
}) {
  return (
    <PageBody>
      <div data-print-hide>
        <PageHeader
          title={title}
          description={description}
          breadcrumbLabel={breadcrumbLabel}
          breadcrumbs={breadcrumbs}
          actions={
            <>
              <PrintButton label={printLabel} />
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link href={back}>
                    <ArrowLeft className="size-4" aria-hidden />
                    {backLabel}
                  </Link>
                }
              />
            </>
          }
        />
      </div>

      {period && (
        <div data-print-hide className="flex flex-wrap items-center gap-2">
          {period}
        </div>
      )}

      {children}
    </PageBody>
  );
}

/**
 * The year a report is narrowed to, as a strip of links.
 *
 * ── Why the years come from the archive ─────────────────────────────────────
 *
 * A fixed range is wrong twice: it offers years the register holds nothing for,
 * and it stops offering the current one the moment the calendar rolls past its
 * ceiling. What is offered is exactly the set of years the rows fall in.
 *
 * ── Why the choice is in the address ────────────────────────────────────────
 *
 * A report narrowed to ۱۴۰۴ is something an office bookmarks, reloads and
 * pastes into an e-mail. Held in component state, none of that survives.
 */
export function PeriodStrip({
  years,
  current,
  hrefFor,
  allLabel,
  label,
  yearLabel,
}: {
  /** Jalali years the register actually holds rows in, newest first. */
  years: number[];
  /** The chosen year, or null for the whole archive. */
  current: number | null;
  hrefFor: (year: number | null) => string;
  allLabel: string;
  label: string;
  yearLabel: (year: number) => string;
}) {
  if (years.length === 0) return null;

  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-xs text-muted-foreground">{label}</span>
      <PeriodLink href={hrefFor(null)} current={current === null} label={allLabel} />
      {years.map((year) => (
        <PeriodLink
          key={year}
          href={hrefFor(year)}
          current={current === year}
          label={yearLabel(year)}
        />
      ))}
    </nav>
  );
}

function PeriodLink({ href, current, label }: { href: string; current: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "numeric rounded-md border px-2.5 py-1 text-xs transition-colors",
        current ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * A band of the report: a heading, a sentence saying what it is, and its panels.
 *
 * The sentence is not decoration. Half of what these screens report is a figure
 * whose meaning is not obvious from its label — «سهم ده داور پرکار» is a number
 * nobody can act on without being told that a high one means the examining is
 * concentrated in few hands.
 */
export function ReportBand({
  title,
  description,
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="max-w-[60rem] text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className={cn("grid gap-4", columns === 2 && "lg:grid-cols-2")}>{children}</div>
    </section>
  );
}
