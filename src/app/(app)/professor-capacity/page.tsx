import { ChartColumn, Download, Filter, Gauge, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Figure } from "@/components/capacity/panels";
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
import {
  CAPACITY_STATES,
  capacityListRows,
  filterCapacityRows,
} from "@/modules/capacity/list-filters.ts";
import { readCapacityExplanations } from "@/modules/capacity/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("capacity");
  return { title: t("title") };
}

const BASE = "/professor-capacity";

export default async function ProfessorCapacityPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    rank?: string | string[];
    state?: string | string[];
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
  const selectedRank = value(params.rank).slice(0, 120);
  const askedState = value(params.state);
  const selectedState = (CAPACITY_STATES as readonly string[]).includes(askedState)
    ? askedState
    : "";
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

  const [reading, lookups, t, actions, format] = await Promise.all([
    readCapacityExplanations(viewer.tenantId),
    lookupTable(viewer.tenantId, ["academic_ranks"]),
    getTranslations("capacity"),
    getTranslations("actions"),
    getFormatter(),
  ]);

  const figure = (value: number) => format.number(value, { maximumFractionDigits: 2 });

  const rankLabel = (value: string | null) =>
    value
      ? (lookups.get("academic_ranks")?.find((entry) => entry.value === value)?.label ?? value)
      : null;

  const allRows = capacityListRows(reading);
  const filteredRows = filterCapacityRows(allRows, {
    search: q,
    rank: selectedRank,
    state: selectedState,
    university: selectedUniversity,
    faculty: selectedFaculty,
    department: selectedDepartment,
    specialization: selectedSpecialization,
  });
  const distinct = (key: "university" | "faculty" | "department" | "specialization") =>
    [...new Set(allRows.map(({ professor }) => professor?.[key]).filter(Boolean) as string[])].sort(
      (a, b) => a.localeCompare(b, "fa"),
    );
  const pages = Math.max(1, Math.ceil(filteredRows.length / size));
  const currentPage = Math.min(page, pages);
  const rows = filteredRows.slice((currentPage - 1) * size, currentPage * size);
  const filterHref = (
    open: boolean,
    nextPage = 1,
    nextSize: (typeof PAGE_SIZES)[number] = size,
  ) => {
    const query = new URLSearchParams();
    if (open) query.set("filters", "open");
    for (const [key, selected] of Object.entries({
      q,
      rank: selectedRank,
      state: selectedState,
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
              <Link href="/professor-capacity/reports">
                <ChartColumn className="size-4" aria-hidden />
                {actions("reports")}
              </Link>
            }
          />
          <ToolbarButton
            render={
              <Link href={`${BASE}/reconcile`}>
                <GitCompareArrows className="size-4" aria-hidden />
                {t("reconcile.title")}
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
          id="capacity-filters"
          className="rounded-xl border border-border/80 bg-card/95 p-4 shadow-2xs"
        >
          <form className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" method="get">
            <input type="hidden" name="filters" value="open" />
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span>{t("professor")}</span>
              <input
                name="q"
                maxLength={MAX_SEARCH_LENGTH}
                defaultValue={q}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                placeholder={t("professor")}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span>{t("rank")}</span>
              <select
                name="rank"
                defaultValue={selectedRank}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">{actions("all")}</option>
                {(lookups.get("academic_ranks") ?? []).map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              <span>{t("quota")}</span>
              <select
                name="state"
                defaultValue={selectedState}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">{actions("all")}</option>
                <option value="noQuota">{t("noQuota")}</option>
                <option value="within">{t("free")}</option>
                <option value="nearLimit">{t("full")}</option>
                <option value="exceeded">{t("over")}</option>
              </select>
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
              <Gauge aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("noYears")}</EmptyTitle>
            <EmptyDescription>{t("noYearsHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex w-full flex-1 min-h-24 flex-col md:min-h-0">
          <Table
            containerClassName="min-h-0 !max-h-none flex-1 rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs"
            className="table-auto min-w-[48rem]"
          >
            <TableHeader className="sticky top-0 z-10 border-b border-border/60 bg-muted/95 shadow-2xs backdrop-blur-[2px]">
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead className="w-[22%] py-2.5 text-xs font-semibold text-foreground/80">
                  {t("professor")}
                </TableHead>
                <TableHead className="w-[15%] py-2.5 text-xs font-semibold text-foreground/80">
                  {t("rank")}
                </TableHead>
                <TableHead
                  data-band="breakdown"
                  className="w-[27%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("dissertation")}
                </TableHead>
                <TableHead
                  data-band="aside"
                  className="w-[27%] py-2.5 text-xs font-semibold text-foreground/80"
                >
                  {t("thesis")}
                </TableHead>
                <TableHead data-print-hide className="w-[9%] py-2.5">
                  {t("details")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/40">
              {rows.map(({ explanation, who }) => (
                <TableRow
                  key={explanation.professorId}
                  className="border-border/40 hover:bg-muted/30 transition-colors"
                >
                  <TableCell>
                    <Link
                      href={`/professors/${explanation.professorId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {who.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {rankLabel(explanation.rank) ?? (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {t("noBase")}
                      </Badge>
                    )}
                  </TableCell>

                  {([explanation.dissertation, explanation.thesis] as const).map((table) => (
                    <TableCell
                      key={table.table}
                      data-band={table.table === "dissertation" ? "breakdown" : "aside"}
                    >
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <Figure value={table.allowance} label={t("allowance")} format={figure} />
                        <Figure value={table.used} label={t("used")} format={figure} />
                        <Figure
                          value={table.remaining}
                          label={t("remaining")}
                          format={figure}
                          {...(table.remaining !== null && table.remaining < 0
                            ? { tone: "over" as const }
                            : {})}
                        />
                        <Figure
                          value={table.internationalUsed}
                          label={t("international")}
                          format={figure}
                          tone="muted"
                        />
                      </div>
                    </TableCell>
                  ))}

                  <TableCell data-print-hide>
                    <Link
                      href={`${BASE}/${explanation.professorId}`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {t("details")}
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
            shown={rows.length}
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
