import { UserRound } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ImportDialog } from "@/components/engine/import-dialog";
import { Pager } from "@/components/engine/pager";
import { RegisterSearch } from "@/components/engine/register-search";
import {
  type RegisterColumn,
  type RegisterFilterView,
  RegisterView,
  type RegisterViewRow,
} from "@/components/engine/register-view";
import { SavedViewsMenu } from "@/components/engine/saved-views";
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
import { formOptions } from "@/lib/lookups.ts";
import { bulkEditableFields } from "@/lib/register/bulk-edit.ts";
import { IMPORT_LIMIT } from "@/lib/register/import.ts";
import { MAX_IMPORT_BYTES } from "@/lib/register/import-action.ts";
import {
  cursorHref,
  filterHref,
  filtersOpen,
  isNarrowed,
  pageSizeHref,
  queryHref,
  readQuery,
  type SearchParams,
} from "@/lib/register/params.ts";
import { deleteView, saveView } from "@/lib/register/saved-view-actions.ts";
import { PAGE_SIZES } from "@/lib/register/spec.ts";
import { requireModule } from "@/lib/viewer.ts";
import {
  bulkEditStudents,
  deleteStudents,
  importStudents,
  planStudentImport,
  rollbackStudentImport,
} from "@/modules/students/actions.ts";
import { STUDENT_FIELDS } from "@/modules/students/fields.ts";
import {
  BULK_EDITABLE,
  FILTERS,
  REGISTER_LOOKUP_SETS,
  type SortKey,
  STUDENT_REGISTER,
} from "@/modules/students/model.ts";
import { readStudentsPageData } from "@/modules/students/register.ts";

/**
 * The student register.
 *
 * The query is resolved here, in one SQL statement, from what the URL says. What
 * crosses into the browser is the ten rows on screen with their vocabulary words
 * already resolved — never the institution's vocabularies, and never a row this
 * viewer may not see.
 */

export async function generateMetadata() {
  const t = await getTranslations("students");
  return { title: t("title") };
}

const BASE = "/students";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { viewer } = await requireModule(BASE);
  const params = await searchParams;
  const query = readQuery(STUDENT_REGISTER, params);

  const [locale, t, common, nav] = await Promise.all([
    getLocale(),
    getTranslations("students"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  /*
   * One tenant context for the whole database portion of this page. Previously
   * four independent read-only transactions each repeated tenant lifecycle and
   * timezone setup and could consume four pool slots for one HTTP request. A
   * single read-only transaction gives the register, denominator, vocabularies
   * and personal views one snapshot and one RLS context.
   */
  const { result, lookups, total, savedViews } = await readStudentsPageData(
    viewer.tenantId,
    viewer.userId,
    BASE,
    query,
    REGISTER_LOOKUP_SETS,
    { includeNationalId: can(viewer, "students.sensitive.read") },
  );

  const canManage = can(viewer, "students.manage");
  const canExport = can(viewer, "data.export");
  const narrowed = isNarrowed(query);
  /*
   * The filter panel opens on request, and stays open whenever something is
   * filtering — a clerk who arrives on a narrowed bookmark must be able to see
   * *what* is narrowing it without hunting for the toggle.
   */
  const filtersShown = filtersOpen(params, query);
  const open = { filtersOpen: filtersShown };

  const sortHref = (key: SortKey) =>
    queryHref(
      STUDENT_REGISTER,
      query,
      { sort: key, direction: query.sort === key && query.direction === "asc" ? "desc" : "asc" },
      open,
    );

  const sortable = (key: SortKey, header: string): RegisterColumn => ({
    key,
    header,
    sortKey: key,
    nextSortDirection: query.sort === key && query.direction === "asc" ? "desc" : "asc",
    sortHref: sortHref(key),
    sortActive: query.sort === key,
    sortDirection: query.direction,
    sortActionLabel: common("sortBy", {
      column: `${header} — ${
        query.sort === key && query.direction === "asc" ? common("sortDesc") : common("sortAsc")
      }`,
    }),
  });

  const columns: RegisterColumn[] = [
    { ...sortable("studentNumber", t("field.studentNumber")), width: "w-28 whitespace-nowrap" },
    /* The row's identity: locked, because a register of people with the names
       hidden is a table nobody can read or report from. */
    { ...sortable("name", t("column.name")), locked: true, width: "w-44" },
    { ...sortable("degree", t("field.degree")), width: "w-28 whitespace-nowrap" },
    { ...sortable("status", t("field.status")), width: "w-28 whitespace-nowrap" },
    { ...sortable("placement", t("column.placement")), width: "w-[22%]" },
    /*
     * Not sortable, and not pretending to be: these show names resolved through
     * a foreign key, and ordering a register by an opaque uuid is an order with
     * no meaning on screen. A header that looks sortable and silently does
     * nothing is worse than one that does not offer.
     */
    { key: "supervisors", header: t("column.supervisors"), width: "w-[22%]" },
    { key: "advisor", header: t("field.advisorId"), width: "w-[18%]" },
  ];

  /** A vocabulary word plus its position, which is what colours the chip. */
  const chip = (set: string, value: string | null) => {
    if (!value) return { text: null };
    const entries = lookups.get(set) ?? [];
    const index = entries.findIndex((entry) => entry.value === value);
    // A value no vocabulary defines is shown as itself — a data fault worth
    // seeing rather than an empty cell that reads as "not recorded".
    return index < 0 ? { text: value } : { text: entries[index]?.label ?? value, tone: index };
  };

  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  const rows: RegisterViewRow[] = result.rows.map((row) => ({
    id: row.id,
    href: `${BASE}/${row.id}`,
    editHref: `${BASE}/${row.id}/edit`,
    /* What the delete confirmation names this row. */
    label: `${row.firstName} ${row.lastName}`,
    version: row.version,
    cells: {
      studentNumber: {
        text: toLocaleDigits(row.studentNumber, locale),
        secondary: row.nationalId ? toLocaleDigits(row.nationalId, locale) : null,
        ltr: true,
      },
      name: {
        text: `${row.firstName} ${row.lastName}`,
        /* The office writes «خانم» or «آقای» on every letter it sends, so the
           register shows which without anybody opening the record. */
        gender: { value: row.gender, label: label("genders", row.gender) },
      },
      degree: chip("degrees", row.degree),
      status: chip("student_statuses", row.status),
      placement: {
        text: label("departments", row.department),
        secondary: label("fields_of_study", row.fieldOfStudy),
      },
      supervisors: { text: row.primarySupervisor, secondary: row.secondarySupervisor },
      advisor: { text: row.advisor },
    },
  }));

  const filters: RegisterFilterView[] = FILTERS.map((filter) => {
    const parentValue = filter.narrowedBy ? query.filters[filter.narrowedBy] : undefined;
    const parentSet = filter.narrowedBy
      ? FILTERS.find((candidate) => candidate.key === filter.narrowedBy)?.set
      : undefined;

    /*
     * A nested filter offers only what the level above contains. Without it a
     * clerk who picks a faculty still scrolls every department in the
     * institution, and can ask for a department that faculty does not have — a
     * question the register correctly answers with nothing, which reads as a
     * broken filter.
     */
    const parentId = parentSet
      ? lookups.get(parentSet)?.find((entry) => entry.value === parentValue)?.id
      : undefined;
    const entries = (lookups.get(filter.set) ?? []).filter((entry) =>
      filter.narrowedBy ? entry.parentId === parentId : true,
    );

    const current = query.filters[filter.key] ?? null;

    return {
      key: filter.key,
      label: t(`field.${filter.key}`),
      value: current,
      valueLabel: current ? label(filter.set, current) : null,
      options: entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        href: filterHref(STUDENT_REGISTER, query, filter.key, entry.value, open),
      })),
      clearHref: filterHref(STUDENT_REGISTER, query, filter.key, null, open),
      ...(filter.narrowedBy && !parentValue
        ? { disabledReason: t("selectFirst", { filter: t(`field.${filter.narrowedBy}`) }) }
        : {}),
    };
  });

  return (
    <PageBody>
      {/*
       * The title, and nothing else.
       *
       * The commands are on the toolbar below, beside the list they act on —
       * which is where the application puts them. A button in the page
       * header is a button the eye has to leave the table to find.
       */}
      <PageHeader
        title={t("title")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title") }]}
      />

      <RegisterView
        enableCompare
        columns={columns}
        rows={rows}
        filters={filters}
        filtersShown={filtersShown}
        toggleFiltersHref={queryHref(STUDENT_REGISTER, query, {}, { filtersOpen: !filtersShown })}
        clearHref={BASE}
        narrowed={narrowed}
        matched={result.total}
        registerSize={total}
        unit={t("count")}
        canManage={canManage}
        canExport={canExport}
        reportsHref="/students/reports"
        /*
         * The export carries the register's own query string, so the file is
         * the rows on screen — the same search, the same filters, the same
         * order — rather than the whole table.
         */
        exportHref={queryHref({ ...STUDENT_REGISTER, basePath: `${BASE}/export` }, query)}
        addHref={`${BASE}/new`}
        addLabel={t("add")}
        importSlot={
          canManage ? (
            <ImportDialog
              key="student-import"
              plan={planStudentImport}
              apply={importStudents}
              rollback={rollbackStudentImport}
              maxBytes={MAX_IMPORT_BYTES}
              limit={IMPORT_LIMIT}
            />
          ) : null
        }
        deleteAction={deleteStudents}
        bulkEditAction={bulkEditStudents}
        bulkEditFields={bulkEditableFields(
          STUDENT_FIELDS,
          can(viewer, "students.degree")
            ? BULK_EDITABLE
            : BULK_EDITABLE.filter((key) => key !== "degree"),
          (set) => formOptions(lookups, set),
          (key) => t(`field.${key}`),
        )}
        /*
         * The address the reader is looking at, saved under a name.
         *
         * The query is taken from `queryHref` rather than from the raw request,
         * so what is stored is this register's own canonical form of the view —
         * defaults omitted, keys in one order — and two people who arrived at
         * the same list by different routes save the same string.
         */
        viewsSlot={
          <SavedViewsMenu
            key="saved-views"
            register={BASE}
            query={queryHref(STUDENT_REGISTER, query, {}, open).split("?")[1] ?? ""}
            views={savedViews}
            saveAction={saveView}
            deleteAction={deleteView}
            canPublish={can(viewer, "saved-views.publish")}
          />
        }
        searchSlot={
          <RegisterSearch
            key="student-search"
            spec={STUDENT_REGISTER}
            query={query}
            placeholder={t("searchPlaceholder")}
            label={common("search")}
          />
        }
        emptySlot={
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRound aria-hidden />
              </EmptyMedia>
              {/*
               * Two different empty states, because they are two different
               * situations and only one is the operator's to fix. Showing "add
               * the first student" to somebody who has just mistyped a name
               * tells them the institution has no students.
               */}
              <EmptyTitle>{narrowed ? t("emptyFiltered") : t("empty")}</EmptyTitle>
              <EmptyDescription>
                {narrowed ? t("emptyFilteredHint") : t("emptyHint")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {narrowed ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={BASE}>{t("clearFilters")}</Link>}
                />
              ) : canManage ? (
                <Button
                  nativeButton={false}
                  render={<Link href={`${BASE}/new`}>{t("add")}</Link>}
                />
              ) : null}
            </EmptyContent>
          </Empty>
        }
        footerSlot={
          <Pager
            page={result.page}
            pages={result.pages}
            total={result.total}
            shown={result.rows.length}
            size={query.size}
            sizes={PAGE_SIZES}
            sizeHrefFor={(size) => pageSizeHref(STUDENT_REGISTER, query, size, open)}
            hrefFor={(page) => queryHref(STUDENT_REGISTER, query, { page }, open)}
            previousHref={
              result.previousCursor
                ? cursorHref(STUDENT_REGISTER, query, result.previousCursor, result.page - 1, open)
                : null
            }
            nextHref={
              result.nextCursor
                ? cursorHref(STUDENT_REGISTER, query, result.nextCursor, result.page + 1, open)
                : null
            }
          />
        }
      />
    </PageBody>
  );
}
