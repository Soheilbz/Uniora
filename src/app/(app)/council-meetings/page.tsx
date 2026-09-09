import { ClipboardList, ListChecks, ScrollText } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { RosterDialog } from "@/components/council/roster-dialog";
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
import { ToolbarButton } from "@/components/engine/toolbar";
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
import { lookupTable } from "@/lib/lookups.ts";
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
  deleteMeetings,
  importMeetings,
  planMeetingImport,
  rollbackMeetingImport,
} from "@/modules/council/actions.ts";
import { MEETING_LOOKUP_SETS, MEETINGS_REGISTER } from "@/modules/council/model.ts";
import {
  councilRegisterSize,
  meetingFilterValues,
  readMeetings,
} from "@/modules/council/queries.ts";
import { readDirectory, readRoster } from "@/modules/council/roster.ts";
import { addRosterSeat, removeRosterSeat } from "@/modules/council/roster-actions.ts";

/**
 * The register of council sittings.
 *
 * The same engine the student register uses, bound to a different spec. What
 * differs is the columns, the words, and that a sitting's most useful column is
 * a count of what it decided.
 */

export async function generateMetadata() {
  const t = await getTranslations("council");
  return { title: t("title") };
}

const BASE = "/council-meetings";

export default async function CouncilMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { viewer } = await requireModule(BASE);
  const params = await searchParams;
  const query = readQuery(MEETINGS_REGISTER, params);

  const [result, lookups, total, typed, locale, t, common, nav, savedViews] = await Promise.all([
    readMeetings(viewer.tenantId, query),
    lookupTable(viewer.tenantId, MEETING_LOOKUP_SETS),
    councilRegisterSize(viewer.tenantId, "meetings"),
    /* The two filters with no reference list behind them — see `MEETING_FILTERS`. */
    meetingFilterValues(viewer.tenantId),
    getLocale(),
    getTranslations("council"),
    getTranslations("common"),
    getTranslations("nav"),
    readSavedViews(viewer.tenantId, viewer.userId, BASE),
  ]);

  const canManage = can(viewer, "council.manage");

  /*
   * The roster and the directory are fetched only for somebody who may manage,
   * because only they are offered the two dialogs that use them. A reader with
   * view-only rights should not have the institution's whole professor
   * directory serialised into their page for controls they will never see.
   */
  const [seats, directory] = canManage
    ? await Promise.all([readRoster(viewer.tenantId), readDirectory(viewer.tenantId)])
    : [[], []];
  const narrowed = isNarrowed(query);
  const filtersShown = filtersOpen(params, query);
  const open = { filtersOpen: filtersShown };

  const sortable = (key: string, header: string): RegisterColumn => ({
    key,
    header,
    sortKey: key,
    nextSortDirection: query.sort === key && query.direction === "asc" ? "desc" : "asc",
    sortHref: queryHref(
      MEETINGS_REGISTER,
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

  /*
   * The sitting's number carries its date underneath rather than taking a
   * column of its own: they are one fact — «which sitting» — and the office says
   * «۶۸۰» and reads the date to confirm it. Given a column of its own, the date
   * pushed the seven this table needs past the width of the screen.
   */
  const columns: RegisterColumn[] = [
    /* A sitting is known by its number the way a person is known by their
       name: every decision in the register cites it. Locked for that reason. */
    {
      ...sortable("meetingNumber", t("field.meetingNumber")),
      locked: true,
      width: "w-28 whitespace-nowrap",
    },
    { ...sortable("time", t("column.time")), width: "w-24 whitespace-nowrap" },
    { ...sortable("location", t("field.meetingLocation")), width: "w-36" },
    { ...sortable("deputy", t("field.researchDeputy")), width: "w-36" },
    /*
     * Not sortable, and not pretending to be: attendance is a count over a jsonb
     * array and business is three correlated subqueries. SQL could order by
     * either, but a header that sorts by a number the reader cannot see the
     * derivation of is a header that produces surprises.
     */
    { key: "attendance", header: t("column.attendance"), width: "w-[32%]" },
    { key: "business", header: t("column.business"), width: "w-24 whitespace-nowrap" },
    { ...sortable("notes", t("field.notes")), width: "w-[24%]" },
  ];

  const dayLabel = (value: string | null) =>
    value
      ? (lookups.get("weekdays")?.find((entry) => entry.value === value)?.label ?? value)
      : null;

  const { dateTime } = await import("next-intl/server").then((module) => module.getFormatter());

  const digits = (value: string | number) => toLocaleDigits(String(value), locale);

  /* The names under each badge, so the figure above is answerable without
     opening the record. The cell clamps them to two lines. */
  const names = (list: string[] | null) =>
    list && list.length > 0
      ? list.join(locale.toLowerCase().startsWith("fa") ? "، " : ", ")
      : t("nobody");

  const rows: RegisterViewRow[] = result.rows.map((row) => {
    /* A deputy represents the missing member only if that deputy is actually
       on this sitting's attendance roll. The assignment map alone is not proof
       of attendance. Keep this exactly aligned with `readMeetings.absentCount`. */
    const attended = new Set((row.participants ?? []).map((name) => name.trim()));
    const stood = row.substitutions ?? {};
    const absent = (row.absentees ?? []).filter((name) => {
      const deputy = stood[name]?.trim();
      return !deputy || !attended.has(deputy);
    });

    return {
      id: row.id,
      version: row.version,
      href: `${BASE}/${row.id}`,
      editHref: `${BASE}/${row.id}/edit`,
      cells: {
        meetingNumber: {
          text: digits(row.meetingNumber),
          secondary: row.meetingDate
            ? dateTime(new Date(row.meetingDate), { dateStyle: "medium" })
            : null,
        },
        /* The clock is digits and follows the reader's numerals; the weekday
           beside it is a word and does not. */
        time: {
          text: row.meetingTime ? digits(row.meetingTime) : null,
          secondary: dayLabel(row.meetingDay),
        },
        location: { text: row.meetingLocation },
        deputy: { text: row.researchDeputy },
        attendance: {
          text: null,
          badges: [
            {
              text: `${digits(row.presentCount)} ${t("present")}`,
              tone: "success" as const,
              caption: names(row.participants),
            },
            {
              text: `${digits(absent.length)} ${t("absent")}`,
              tone: "danger" as const,
              caption: names(absent),
            },
          ],
        },
        /*
         * What the sitting actually resolved.
         *
         * Without it the register listed sittings and said nothing about what
         * any of them did, so one that produced nothing looked exactly like one
         * that produced fourteen decisions. Zero is said in words and quietly —
         * a badge reading «۰ مورد» reads as a figure, where what is meant is an
         * absence.
         */
        business:
          row.businessCount === 0
            ? { text: t("noBusiness"), muted: true }
            : {
                text: `${digits(row.businessCount)} ${t("businessUnit")}`,
                statusTone: "info" as const,
              },
        notes: { text: row.notes, clamp: true },
      },
    };
  });

  const filters: RegisterFilterView[] = MEETINGS_REGISTER.filters.map((filter) => {
    const current = query.filters[filter.key] ?? null;
    /* Every filter on this register is backed by a vocabulary; the empty list
       is the honest answer for a `set: null` one, which none of them has. */
    /*
     * A free-text filter has no reference list, so its options are the values
     * the column actually holds — and its «label» is the value, because there
     * is nothing else it could be.
     */
    const entries =
      filter.set === null
        ? (filter.key === "deputy" ? typed.deputy : typed.location).map((value) => ({
            value,
            label: value,
          }))
        : (lookups.get(filter.set) ?? []);
    return {
      key: filter.key,
      label: t(`field.${filter.key}`),
      value: current,
      valueLabel: current
        ? (entries.find((entry) => entry.value === current)?.label ?? current)
        : null,
      options: entries.map((entry) => ({
        value: entry.value,
        label: entry.label,
        href: filterHref(MEETINGS_REGISTER, query, filter.key, entry.value, open),
      })),
      clearHref: filterHref(MEETINGS_REGISTER, query, filter.key, null, open),
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
        columns={columns}
        rows={rows}
        filters={filters}
        filtersShown={filtersShown}
        toggleFiltersHref={queryHref(MEETINGS_REGISTER, query, {}, { filtersOpen: !filtersShown })}
        clearHref={BASE}
        narrowed={narrowed}
        matched={result.total}
        registerSize={total}
        unit={t("count")}
        canManage={canManage}
        canExport={can(viewer, "data.export")}
        reportsHref="/council-meetings/reports"
        exportHref={queryHref({ ...MEETINGS_REGISTER, basePath: `${BASE}/export` }, query)}
        addHref={`${BASE}/new`}
        addLabel={t("add")}
        importSlot={
          canManage ? (
            <ImportDialog
              key="meeting-import"
              plan={planMeetingImport}
              apply={importMeetings}
              rollback={rollbackMeetingImport}
              maxBytes={MAX_IMPORT_BYTES}
              limit={IMPORT_LIMIT}
            />
          ) : null
        }
        deleteAction={deleteMeetings}
        reportActions={
          <Fragment key="meeting-reports">
            <ToolbarButton
              nativeButton={false}
              render={
                <Link href="/council-minutes">
                  <ScrollText className="size-4" aria-hidden />
                  {t("generateMinutes")}
                </Link>
              }
            />
            <ToolbarButton
              nativeButton={false}
              render={
                <Link href="/council-checklist">
                  <ListChecks className="size-4" aria-hidden />
                  {t("generateChecklist")}
                </Link>
              }
            />
          </Fragment>
        }
        /*
         * The council's two side registers, filed after «ویرایش» because that
         * is what they are: edits to lists the council keeps beside its
         * minutes. They are not documents and do not belong beside «چاپ».
         */
        recordActions={
          <RosterDialog
            key="meeting-roster"
            seats={seats}
            directory={directory}
            addAction={addRosterSeat}
            removeAction={removeRosterSeat}
          />
        }
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
            query={queryHref(MEETINGS_REGISTER, query, {}, open).split("?")[1] ?? ""}
            views={savedViews}
            saveAction={saveView}
            deleteAction={deleteView}
            canPublish={can(viewer, "saved-views.publish")}
          />
        }
        searchSlot={
          <RegisterSearch
            spec={MEETINGS_REGISTER}
            query={query}
            placeholder={t("searchPlaceholder")}
            label={common("search")}
          />
        }
        emptySlot={
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList aria-hidden />
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
            sizeHrefFor={(size) => pageSizeHref(MEETINGS_REGISTER, query, size, open)}
            hrefFor={(page) => queryHref(MEETINGS_REGISTER, query, { page }, open)}
            previousHref={
              result.previousCursor
                ? cursorHref(MEETINGS_REGISTER, query, result.previousCursor, result.page - 1, open)
                : null
            }
            nextHref={
              result.nextCursor
                ? cursorHref(MEETINGS_REGISTER, query, result.nextCursor, result.page + 1, open)
                : null
            }
          />
        }
      />
    </PageBody>
  );
}
