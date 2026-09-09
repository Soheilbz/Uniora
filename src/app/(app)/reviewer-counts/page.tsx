import { ChartColumn, Download, Filter, ListTree } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Pager } from "@/components/engine/pager";
import { Toolbar, ToolbarButton, ToolbarGroup } from "@/components/engine/toolbar";
import { PageBody } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MAX_SEARCH_LENGTH, parseIntegerParam } from "@/lib/input-limits.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { isPageSize, MAX_PAGE, PAGE_SIZES } from "@/lib/register/spec.ts";
import { requireModule } from "@/lib/viewer.ts";
import { filterReviewerRows } from "@/modules/capacity/list-filters.ts";
import { readReviewerCounts } from "@/modules/capacity/reviewers.ts";

export async function generateMetadata() {
  const t = await getTranslations("reviewers");
  return { title: t("title") };
}

const BASE = "/reviewer-counts";

export default async function ReviewerCountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    kind?: string | string[];
    min?: string | string[];
    university?: string | string[];
    faculty?: string | string[];
    department?: string | string[];
    specialization?: string | string[];
    page?: string | string[];
    size?: string | string[];
    filters?: string | string[];
  }>;
}) {
  const { viewer } = await requireModule(BASE);
  const params = await searchParams;
  const value = (input: string | string[] | undefined) =>
    Array.isArray(input) ? (input[0] ?? "") : (input ?? "");
  const q = value(params.q).trim().slice(0, MAX_SEARCH_LENGTH);
  const askedKind = value(params.kind);
  const kind = askedKind === "external" || askedKind === "internal" ? askedKind : "";
  const parsedMin = parseIntegerParam(value(params.min));
  const min = parsedMin !== null && parsedMin >= 0 ? parsedMin : null;
  const selectedUniversity = value(params.university).slice(0, 300);
  const selectedFaculty = value(params.faculty).slice(0, 300);
  const selectedDepartment = value(params.department).slice(0, 300);
  const selectedSpecialization = value(params.specialization).slice(0, 300);
  const requestedSize = parseIntegerParam(value(params.size));
  const size: (typeof PAGE_SIZES)[number] = isPageSize(requestedSize)
    ? requestedSize
    : PAGE_SIZES[0];
  const requestedPage = parseIntegerParam(value(params.page));
  const page = requestedPage !== null && requestedPage > 0 ? Math.min(requestedPage, MAX_PAGE) : 1;
  const filtersShown = value(params.filters) === "open";

  const [rows, lookups, format, t, actions] = await Promise.all([
    readReviewerCounts(viewer.tenantId),
    lookupTable(viewer.tenantId, ["academic_ranks"]),
    getFormatter(),
    getTranslations("reviewers"),
    getTranslations("actions"),
  ]);

  const rankLabel = (value: string | null) =>
    value
      ? (lookups.get("academic_ranks")?.find((entry) => entry.value === value)?.label ?? value)
      : null;

  const filteredRows = filterReviewerRows(rows, {
    search: q,
    kind,
    minimum: min,
    university: selectedUniversity,
    faculty: selectedFaculty,
    department: selectedDepartment,
    specialization: selectedSpecialization,
  });
  const distinct = (key: "university" | "faculty" | "department" | "specialization") =>
    [...new Set(rows.map((row) => row[key]).filter(Boolean) as string[])].sort((a, b) =>
      a.localeCompare(b, "fa"),
    );
  const pages = Math.max(1, Math.ceil(filteredRows.length / size));
  const currentPage = Math.min(page, pages);
  const visibleRows = filteredRows.slice((currentPage - 1) * size, currentPage * size);
  const filterHref = (
    open: boolean,
    nextPage = 1,
    nextSize: (typeof PAGE_SIZES)[number] = size,
  ) => {
    const query = new URLSearchParams();
    if (open) query.set("filters", "open");
    for (const [key, selected] of Object.entries({
      q,
      kind,
      min: min === null ? "" : String(min),
      university: selectedUniversity,
      faculty: selectedFaculty,
      department: selectedDepartment,
      specialization: selectedSpecialization,
    })) {
      if (selected) query.set(key, selected);
    }
    if (nextPage > 1) query.set("page", String(nextPage));
    if (nextSize !== PAGE_SIZES[0]) query.set("size", String(nextSize));
    const queryString = query.toString();
    return queryString ? `${BASE}?${queryString}` : BASE;
  };
  const exportHref = (() => {
    const source = new URL(filterHref(false), "https://local.invalid");
    source.searchParams.delete("page");
    source.searchParams.delete("size");
    source.pathname = `${BASE}/export`;
    return `${source.pathname}${source.search}`;
  })();

  return (
    <PageBody>
      <h1 className="sr-only">{t("title")}</h1>
      {/* Top Toolbar Strip */}
      <Toolbar label={t("title")}>
        <ToolbarGroup label={t("title")}>
          <ToolbarButton
            render={
              <Link href="/reviewer-counts/reports">
                <ChartColumn className="size-4" aria-hidden />
                {actions("reports")}
              </Link>
            }
          />
          <ToolbarButton
            checked={filtersShown}
            render={
              <Link href={filterHref(!filtersShown)}>
                <Filter className="size-4" aria-hidden />
                {actions("filters")}
              </Link>
            }
          />
          <ToolbarButton
            render={
              <a href={exportHref} download>
                <Download className="size-4" aria-hidden />
                {actions("export")}
              </a>
            }
          />
        </ToolbarGroup>
      </Toolbar>

      {filtersShown && (
        <div
          id="reviewer-filters"
          className="rounded-xl border border-border/80 bg-card/95 p-4 shadow-2xs"
        >
          <form className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" method="get">
            <input type="hidden" name="filters" value="open" />
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span>{t("examiner")}</span>
              <input
                name="q"
                maxLength={MAX_SEARCH_LENGTH}
                defaultValue={q}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                placeholder={t("examiner")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span>{t("staff")}</span>
              <select
                name="kind"
                defaultValue={kind}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">{actions("all")}</option>
                <option value="internal">{t("staff")}</option>
                <option value="external">{t("external")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span>{t("reviews")}</span>
              <input
                name="min"
                type="number"
                min="0"
                defaultValue={min ?? ""}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                placeholder="0"
              />
            </label>
            {(
              [
                ["university", t("university"), selectedUniversity],
                ["faculty", t("faculty"), selectedFaculty],
                ["department", t("department"), selectedDepartment],
                ["specialization", t("specialization"), selectedSpecialization],
              ] as const
            ).map(([key, label, selected]) => (
              <label key={key} className="flex flex-col gap-1 text-xs font-medium">
                <span>{label}</span>
                <select
                  name={key}
                  defaultValue={selected}
                  className="h-9 min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="">{actions("all")}</option>
                  {distinct(key).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex gap-2 sm:col-span-2 xl:col-span-4">
              <button
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                type="submit"
              >
                {actions("apply")}
              </button>
              <Link className="rounded-lg border border-border px-4 py-2 text-xs" href={BASE}>
                {actions("clearFilters")}
              </Link>
            </div>
          </form>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListTree aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("empty")}</EmptyTitle>
            <EmptyDescription>{t("emptyHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex w-full flex-1 min-h-24 flex-col md:min-h-0">
          <Table
            containerClassName="min-h-0 !max-h-none flex-1 rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs"
            className="table-auto min-w-[64rem]"
          >
            <TableHeader className="sticky top-0 z-10 border-b border-border/60 bg-muted/95 shadow-2xs backdrop-blur-[2px]">
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead className="w-[18%] py-2.5 text-xs font-semibold text-foreground/80">
                  {t("examiner")}
                </TableHead>
                <TableHead className="w-[10%] py-2.5 text-xs font-semibold text-foreground/80">
                  {t("rank")}
                </TableHead>
                <TableHead className="w-[8%] py-2.5 text-xs font-semibold text-foreground/80">
                  {t("reviews")}
                </TableHead>
                <TableHead
                  data-band="breakdown"
                  className="w-[9%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("masters")}
                </TableHead>
                <TableHead
                  data-band="breakdown"
                  className="w-[10%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("generalDoctorate")}
                </TableHead>
                <TableHead
                  data-band="breakdown"
                  className="w-[11%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("specializedDoctorate")}
                </TableHead>
                <TableHead
                  data-band="aside"
                  className="w-[11%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("representations")}
                </TableHead>
                <TableHead
                  data-band="aside"
                  className="w-[8%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("cases")}
                </TableHead>
                <TableHead
                  data-band="aside"
                  className="w-[10%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("lastReview")}
                </TableHead>
                <TableHead data-print-hide className="w-[5%] py-2.5">
                  {t("details")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/40">
              {visibleRows.map((row) => (
                <TableRow
                  key={row.professorId ?? row.name}
                  className="border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <TableCell className="font-medium">
                    {row.professorId ? (
                      <Link
                        href={`/professors/${row.professorId}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>{row.name}</span>
                        <Badge
                          variant="secondary"
                          className="font-normal text-[11px] text-muted-foreground"
                        >
                          {t("external")}
                        </Badge>
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-muted-foreground">
                    {rankLabel(row.academicRank) ?? (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>

                  <TableCell className="numeric font-semibold tabular-nums">
                    {format.number(row.reviews)}
                  </TableCell>

                  <TableCell data-band="breakdown" className="numeric tabular-nums">
                    {row.masters ? (
                      format.number(row.masters)
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>

                  <TableCell data-band="breakdown" className="numeric tabular-nums">
                    {row.generalDoctorate ? (
                      format.number(row.generalDoctorate)
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>

                  <TableCell data-band="breakdown" className="numeric tabular-nums">
                    {row.specializedDoctorate ? (
                      format.number(row.specializedDoctorate)
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>

                  <TableCell
                    data-band="aside"
                    className="numeric tabular-nums text-muted-foreground"
                  >
                    {row.representations ? (
                      format.number(row.representations)
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>

                  <TableCell
                    data-band="aside"
                    className="numeric tabular-nums text-muted-foreground"
                  >
                    {format.number(row.cases)}
                  </TableCell>

                  <TableCell data-band="aside" className="numeric text-xs text-muted-foreground">
                    {row.lastReviewDate ? (
                      format.dateTime(new Date(row.lastReviewDate), { dateStyle: "medium" })
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>

                  <TableCell data-print-hide>
                    <Link
                      href={`${BASE}/cases?reviewer=${encodeURIComponent(row.name)}`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {t("working.link")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            page={currentPage}
            pages={pages}
            total={filteredRows.length}
            shown={visibleRows.length}
            size={size}
            sizes={PAGE_SIZES}
            sizeHrefFor={(nextSize) => filterHref(true, 1, isPageSize(nextSize) ? nextSize : size)}
            hrefFor={(nextPage) => filterHref(true, nextPage, size)}
          />
        </div>
      )}
    </PageBody>
  );
}
