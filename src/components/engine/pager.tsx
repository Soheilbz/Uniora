import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { TablePagination } from "@/components/ui/table-pagination";
import { directionOf, isLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * The register's foot: how many records there are, and how to reach the rest.
 *
 * Links again, for the reasons in `SortableHeader` — and here there is a second
 * one. A pager built from buttons cannot be middle-clicked, and "open page 4 in
 * a new tab while I keep reading page 3" is something people do with a register
 * constantly.
 *
 * Deliberately not a numbered pager. Numbered pages are useful when the pages
 * mean something — a book, a printed list — and this ordering changes with every
 * sort, so «صفحه ۷» is not a place anyone can return to. Previous, next, and an
 * honest count of what the filters actually matched.
 */
export async function Pager({
  page,
  pages,
  total,
  shown,
  size,
  sizes,
  sizeHrefFor,
  hrefFor,
  previousHref,
  nextHref,
}: {
  page: number;
  pages: number;
  total: number;
  /** Rows actually on screen — the last page is rarely a full one. */
  shown: number;
  size: number;
  sizes: readonly number[];
  sizeHrefFor: (size: number) => string;
  hrefFor: (page: number) => string;
  previousHref?: string | null;
  nextHref?: string | null;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const rtl = directionOf(isLocale(locale) ? locale : "fa") === "rtl";

  /*
   * The chevrons are physical directions and have to be swapped by hand.
   *
   * "Previous" points towards the start of the text, which in a right-to-left
   * document is the *right*. `ChevronLeft` in Persian would point at the next
   * page while sitting on the button that goes back — an arrow that contradicts
   * its own label is worse than no arrow.
   */
  const Previous = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  const step = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1");
  const disabled = "pointer-events-none opacity-50";
  const previous =
    previousHref === undefined ? (page > 1 ? hrefFor(page - 1) : null) : previousHref;
  const next = nextHref === undefined ? (page < pages ? hrefFor(page + 1) : null) : nextHref;

  return (
    <TablePagination>
      {/*
       * The count of what matched, not of what is on screen. A clerk who has
       * filtered to «۳ رکورد» needs to know the filter found three people —
       * "showing 3" would say the same thing on a page of a much larger set.
       */}
      {/*
       * What is on screen, out of what matched. The count of matches alone does
       * not tell somebody on the last page whether they are looking at three
       * records or thirty.
       */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="numeric text-xs font-medium text-muted-foreground">
          {t("showing", { shown, total })}
        </p>

        {/*
         * The page size, as a row of links rather than a select.
         *
         * Four options is fewer than the two clicks a dropdown costs to reach
         * any of them, and each is a real address — so «۱۰۰ در هر صفحه» is a
         * view somebody can bookmark or send to a colleague. A select would also
         * need JavaScript to navigate; these do not.
         */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="hidden sm:inline font-medium">{t("perPage")}</span>
          <div className="flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5">
            {sizes.map((option) =>
              option === size ? (
                <span
                  key={option}
                  aria-current="true"
                  className="numeric rounded-md bg-background px-2 py-0.5 font-bold text-primary shadow-2xs"
                >
                  {t("plainNumber", { value: option })}
                </span>
              ) : (
                <Link
                  key={option}
                  href={sizeHrefFor(option)}
                  className="numeric rounded-md px-2 py-0.5 font-medium hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {t("plainNumber", { value: option })}
                </Link>
              ),
            )}
          </div>
        </div>
      </div>

      <nav aria-label={t("page", { page, pages })} className="flex items-center gap-2">
        {/*
         * `aria-disabled` and no href on the ends, rather than a hidden button.
         *
         * A control that vanishes on the first page moves the "next" button
         * sideways between page 1 and page 2, so the thing somebody is clicking
         * repeatedly is never where they left it. It stays, and says it cannot
         * be used.
         */}
        {previous ? (
          <Link href={previous} className={step} rel="prev">
            <Previous className="size-4" aria-hidden />
            {t("previous")}
          </Link>
        ) : (
          <span aria-disabled className={cn(step, disabled)}>
            <Previous className="size-4" aria-hidden />
            {t("previous")}
          </span>
        )}

        <span className="numeric rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1 text-xs font-semibold text-foreground">
          {t("page", { page, pages })}
        </span>

        {next ? (
          <Link href={next} className={step} rel="next">
            {t("next")}
            <Next className="size-4" aria-hidden />
          </Link>
        ) : (
          <span aria-disabled className={cn(step, disabled)}>
            {t("next")}
            <Next className="size-4" aria-hidden />
          </span>
        )}
      </nav>
    </TablePagination>
  );
}
