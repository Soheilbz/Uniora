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
import { formOptions, lookupTable } from "@/lib/lookups.ts";
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
import { readSavedViews } from "@/lib/register/saved-views.ts";
import { PAGE_SIZES } from "@/lib/register/spec.ts";
import { requireModule } from "@/lib/viewer.ts";
import {
  bulkEditProfessors,
  deleteProfessors,
  importProfessors,
  planProfessorImport,
  rollbackProfessorImport,
} from "@/modules/professors/actions.ts";
import { PROFESSOR_FIELDS } from "@/modules/professors/fields.ts";
import {
  BULK_EDITABLE,
  FILTERS,
  PROFESSOR_REGISTER,
  REGISTER_LOOKUP_SETS,
} from "@/modules/professors/model.ts";
import { readProfessors, registerSize, specialisations } from "@/modules/professors/register.ts";

/**
 * The professor directory.
 *
 * The query is resolved here, in one SQL statement, from what the URL says. What
 * crosses into the browser is the rows on screen with their vocabulary words
 * already resolved — never the institution's vocabularies, and never a row this
 * viewer may not see.
 */

export async function generateMetadata() {
  const t = await getTranslations("professors");
  return { title: t("title") };
}

const BASE = "/professors";

export default async function ProfessorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { viewer } = await requireModule(BASE);
  const params = await searchParams;
  const query = readQuery(PROFESSOR_REGISTER, params);

  const [result, lookups, total, specialities, t, common, nav, locale, savedViews] =
    await Promise.all([
      readProfessors(viewer.tenantId, query, {
        includeNationalId: can(viewer, "professors.sensitive.read"),
      }),
      lookupTable(viewer.tenantId, REGISTER_LOOKUP_SETS),
      registerSize(viewer.tenantId),
      /* The one filter with no reference list behind it — see `FILTERS`. */
      specialisations(viewer.tenantId),
      getTranslations("professors"),
      getTranslations("common"),
      getTranslations("nav"),
      getLocale(),
      readSavedViews(viewer.tenantId, viewer.userId, BASE),
    ]);

  const canManage = can(viewer, "professors.manage");
  const narrowed = isNarrowed(query);
  const filtersShown = filtersOpen(params, query);
  const open = { filtersOpen: filtersShown };

  const sortable = (key: string, header: string): RegisterColumn => ({
    key,
    header,
    sortKey: key,
    nextSortDirection: query.sort === key && query.direction === "asc" ? "desc" : "asc",
    sortHref: queryHref(
      PROFESSOR_REGISTER,
      query,
      { sort: key, direction: query.sort === key && query.direction === "asc" ? "desc" : "asc" },
      open,
    ),
    sortActive: query.sort === key,
    sortDirection: query.direction,
    sortActionLabel: common("sortBy", {
      column: `${header} — ${
        query.sort === key && query.direction === "asc" ? common("sortDesc") : common("sortAsc")
      }`,
    }),
  });

  const columns: RegisterColumn[] = [
    { ...sortable("professorCode", t("field.professorCode")), width: "w-28 whitespace-nowrap" },
    /* The row's identity — see the students' copy. */
    { ...sortable("name", t("column.name")), locked: true, width: "w-44" },
    { ...sortable("rank", t("field.academicRank")), width: "w-28 whitespace-nowrap" },
    /*
     * Faculty membership is a column of its own rather than a note under the
     * name. It is the first thing the office filters a directory of two hundred
     * by — a visiting lecturer cannot hold a supervision seat — and a mark that
     * only appears on the exception is a mark whose absence has to be read as
     * meaning something.
     */
    { key: "faculty", header: t("field.isFacultyMember"), width: "w-28 whitespace-nowrap" },
    { ...sortable("affiliation", t("column.affiliation")), width: "w-[22%]" },
    { ...sortable("department", t("field.department")), width: "w-[22%]" },
    /*
     * No supervision count here, deliberately.
     *
     * A bare «۵» in a directory is a number with no denominator: five out of an
     * allowance of four is a professor who cannot take another student, and five
     * out of six is one who can. `/professor-capacity` answers it with the
     * allowance beside it, which is the only form of the figure anybody can act
     * on — and the register makes the same division.
     */
    { key: "contact", header: t("column.contact"), width: "w-[18%]" },
  ];

  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  /**
   * A vocabulary word plus its position, which is what colours the chip.
   *
   * Position rather than a value-to-colour map: a rank is a taxonomy and the
   * academic ladder is its own order, so the tones climb it in step. A value no
   * vocabulary defines shows as itself, uncoloured — a data fault in front of
   * the person who can correct it beats an empty cell reading «not recorded».
   */
  const chip = (set: string, value: string | null) => {
    if (!value) return { text: null };
    const entries = lookups.get(set) ?? [];
    const index = entries.findIndex((entry) => entry.value === value);
    return index < 0 ? { text: value } : { text: entries[index]?.label ?? value, tone: index };
  };

  const rows: RegisterViewRow[] = result.rows.map((row) => ({
    id: row.id,
    href: `${BASE}/${row.id}`,
    editHref: `${BASE}/${row.id}/edit`,
    /* What the delete confirmation names this row. */
    label: `${row.firstName} ${row.lastName}`,
    version: row.version,
    cells: {
      professorCode: {
        text: row.professorCode ? toLocaleDigits(row.professorCode, locale) : null,
        /* The national id under the staff code: the two identifiers an office
           looks somebody up by, in the order it holds them. */
        secondary:
          can(viewer, "professors.sensitive.read") && row.nationalId
            ? toLocaleDigits(row.nationalId, locale)
            : null,
        ltr: true,
      },
      name: {
        text: `${row.firstName} ${row.lastName}`,
        /* The same marker the student register carries, for the same reason:
           the office addresses a colleague as «خانم» or «آقای» in writing. */
        gender: { value: row.gender, label: label("genders", row.gender) },
      },
      /*
       * The ladder in the reference list's own colours, not four identical
       * chips. A rank is an identity rather than a standing — nobody is doing
       * better for being «دانشیار» than «مربی» — so the tone comes from the
       * entry's position, which here *is* the ladder: the colours climb it in
       * step.
       */
      rank: chip("academic_ranks", row.academicRank),
      /*
       * A filled mark for yes, a quiet one for no, and a dash for a record
       * that has never been asked. Three renderings for three states — the
       * dash is not a third kind of «no», it says the personnel file this row
       * was transcribed from did not answer.
       */
      faculty:
        row.isFacultyMember === "yes"
          ? { text: common("yes"), statusTone: "info" as const }
          : row.isFacultyMember === "no"
            ? { text: common("no"), muted: true }
            : { text: null },
      /*
       * The university and the faculty on one line: the pair is a single
       * address. Only the halves that are on file, though — a directory holds
       * plenty of people with no university recorded, and a separator drawn
       * regardless turns those rows into «— / —», a row of punctuation saying
       * "two things are missing" where one dash says "not recorded".
       */
      affiliation: {
        text:
          [label("universities", row.university), label("faculties", row.faculty)]
            .filter(Boolean)
            .join(" / ") || null,
      },
      department: { text: label("departments", row.department) },
      /*
       * The telephone first and the address under it, which is the order the
       * office reaches somebody in. Both absent gives one dash rather than two
       * stacked ones — twice the ink for a single missing fact.
       */
      contact: {
        text: row.phone ? toLocaleDigits(row.phone, locale) : null,
        secondary: row.email,
        ltr: true,
      },
    },
  }));

  const filters: RegisterFilterView[] = FILTERS.map((filter) => {
    const current = query.filters[filter.key] ?? null;
    /*
     * A free-text filter has no reference list, so its options are the values
     * the column actually holds — and its «label» is the value, because there
     * is nothing else it could be.
     */
    const entries =
      filter.set === null
        ? specialities.map((value) => ({ value, label: value }))
        : (lookups.get(filter.set) ?? []);

    return {
      key: filter.key,
      label: t(`filter.${filter.key}`),
      value: current,
      valueLabel: current
        ? (entries.find((entry) => entry.value === current)?.label ?? current)
        : null,
      options: entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        href: filterHref(PROFESSOR_REGISTER, query, filter.key, entry.value, open),
      })),
      clearHref: filterHref(PROFESSOR_REGISTER, query, filter.key, null, open),
    };
  });

  return (
    <PageBody>
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
        toggleFiltersHref={queryHref(PROFESSOR_REGISTER, query, {}, { filtersOpen: !filtersShown })}
        clearHref={BASE}
        narrowed={narrowed}
        matched={result.total}
        registerSize={total}
        unit={t("count")}
        canManage={canManage}
        canExport={can(viewer, "data.export")}
        exportHref={queryHref({ ...PROFESSOR_REGISTER, basePath: `${BASE}/export` }, query)}
        reportsHref="/professors/reports"
        addHref={`${BASE}/new`}
        addLabel={t("add")}
        importSlot={
          canManage ? (
            <ImportDialog
              key="professor-import"
              plan={planProfessorImport}
              apply={importProfessors}
              rollback={rollbackProfessorImport}
              maxBytes={MAX_IMPORT_BYTES}
              limit={IMPORT_LIMIT}
            />
          ) : null
        }
        deleteAction={deleteProfessors}
        bulkEditAction={bulkEditProfessors}
        bulkEditFields={bulkEditableFields(
          PROFESSOR_FIELDS,
          BULK_EDITABLE,
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
            query={queryHref(PROFESSOR_REGISTER, query, {}, open).split("?")[1] ?? ""}
            views={savedViews}
            saveAction={saveView}
            deleteAction={deleteView}
            canPublish={can(viewer, "saved-views.publish")}
          />
        }
        searchSlot={
          <RegisterSearch
            spec={PROFESSOR_REGISTER}
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
            sizeHrefFor={(size) => pageSizeHref(PROFESSOR_REGISTER, query, size, open)}
            hrefFor={(page) => queryHref(PROFESSOR_REGISTER, query, { page }, open)}
            previousHref={
              result.previousCursor
                ? cursorHref(
                    PROFESSOR_REGISTER,
                    query,
                    result.previousCursor,
                    result.page - 1,
                    open,
                  )
                : null
            }
            nextHref={
              result.nextCursor
                ? cursorHref(PROFESSOR_REGISTER, query, result.nextCursor, result.page + 1, open)
                : null
            }
          />
        }
      />
    </PageBody>
  );
}
