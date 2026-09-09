import { Gavel, ListChecks, Scale, ScrollText, UserCheck } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { ImportDialog } from "@/components/engine/import-dialog";
import { Pager } from "@/components/engine/pager";
import { RegisterSearch } from "@/components/engine/register-search";
import { RegisterTabs } from "@/components/engine/register-tabs";
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
  deleteDecisions,
  importDecisions,
  planDecisionImport,
  rollbackDecisionImport,
} from "@/modules/council/actions.ts";
import {
  DECISION_LOOKUP_SETS,
  DECISION_TABS,
  type DecisionTab,
  isDecisionTab,
  REGISTER_FOR_TAB,
} from "@/modules/council/model.ts";
import { readDecisions } from "@/modules/council/queries.ts";
import { readAppointments, readRulings, tabCounts } from "@/modules/council/registers.ts";
import { deleteAppointments, deleteRulings } from "@/modules/council/tab-actions.ts";

/**
 * The council's business, in three registers on one screen.
 *
 * Decisions on students' files, rulings that name no student, and the
 * supervision the council appointed. Three tables, three sets of columns, one
 * address — because an office looking for "what the council did" does not know
 * in advance which of the three it is.
 */

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
  /*
   * The tab names the browser tab.
   *
   * Three registers on one address means three screens with one title, and an
   * office with «مصوبات شورا» open three times cannot tell which is the
   * rulings. `generateMetadata` gets the same search params the page does.
   */
  const params = await searchParams;
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: DecisionTab = isDecisionTab(raw) ? raw : "decisions";
  const words = await getTranslations(tab === "decisions" ? "decisions" : tab);
  return { title: words("title") };
}

const BASE = "/council-decisions";

export default async function CouncilDecisionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { viewer } = await requireModule(BASE);
  const params = await searchParams;

  /*
   * A hand-edited or stale tab falls back to the first one rather than showing
   * three empty panels — the same fail-to-something rule the rest of the URL
   * layer follows.
   */
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: DecisionTab = isDecisionTab(raw) ? raw : "decisions";
  const spec = REGISTER_FOR_TAB[tab];
  const query = readQuery(spec, params);

  const [counts, lookups, locale, format, t, words, common, nav, savedViews] = await Promise.all([
    tabCounts(viewer.tenantId),
    lookupTable(viewer.tenantId, DECISION_LOOKUP_SETS),
    getLocale(),
    getFormatter(),
    getTranslations("decisions"),
    /*
     * Two namespaces, and the split is deliberate.
     *
     * `t` is the decisions catalogue, which holds the *field* labels — all three
     * tables carry the same sitting and student columns, so «شماره جلسه» is one
     * string. `words` is whichever register this tab is, and holds the words
     * that must differ: a ruling's empty state saying «مصوبه‌ای ثبت نشده» tells
     * a clerk they are looking at the wrong list.
     */
    getTranslations(tab === "decisions" ? "decisions" : tab),
    getTranslations("common"),
    getTranslations("nav"),
    readSavedViews(viewer.tenantId, viewer.userId, BASE),
  ]);

  const canManage = can(viewer, "council.manage");
  const narrowed = isNarrowed(query);
  const filtersShown = filtersOpen(params, query);

  /* The tab has to survive every navigation the register makes. */
  const open = { filtersOpen: filtersShown };
  const withTab = (href: string) => {
    if (tab === "decisions") return href;
    return href.includes("?") ? `${href}&tab=${tab}` : `${href}?tab=${tab}`;
  };

  const sortable = (key: string, header: string): RegisterColumn => ({
    key,
    header,
    sortKey: key,
    nextSortDirection: query.sort === key && query.direction === "asc" ? "desc" : "asc",
    sortHref: withTab(
      queryHref(
        spec,
        query,
        { sort: key, direction: query.sort === key && query.direction === "asc" ? "desc" : "asc" },
        open,
      ),
    ),
    sortActive: query.sort === key,
    sortDirection: query.direction,
    sortActionLabel: common("sortBy", {
      column: `${header} — ${
        query.sort === key && query.direction === "asc" ? common("sortDesc") : common("sortAsc")
      }`,
    }),
  });

  const chip = (set: string, value: string | null) => {
    if (!value) return { text: null };
    const entries = lookups.get(set) ?? [];
    const index = entries.findIndex((entry) => entry.value === value);
    return index < 0 ? { text: value } : { text: entries[index]?.label ?? value, tone: index };
  };

  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  const meetingCell = (number: string, date: string | null) => ({
    text: toLocaleDigits(number, locale),
    secondary: date ? format.dateTime(new Date(date), { dateStyle: "medium" }) : null,
  });

  /* ── Whichever register this tab is ─────────────────────────────────── */

  let columns: RegisterColumn[];
  let rows: RegisterViewRow[];
  let result:
    | Awaited<ReturnType<typeof readDecisions>>
    | Awaited<ReturnType<typeof readRulings>>
    | Awaited<ReturnType<typeof readAppointments>>;
  let deleteAction: typeof deleteDecisions | typeof deleteRulings | typeof deleteAppointments;
  let addHref: string;
  let icon: typeof Scale;

  if (tab === "rulings") {
    result = await readRulings(viewer.tenantId, query);
    deleteAction = deleteRulings;
    addHref = `${BASE}/rulings/new`;
    icon = Gavel;
    /*
     * The wording and the note beside it are two columns, not one cell with a
     * quiet second line. A ruling's text is the resolution and its description
     * is the office's annotation on it; stacked, the annotation reads as part
     * of what the council resolved.
     */
    columns = [
      { ...sortable("meeting", t("column.meeting")), width: "w-28 whitespace-nowrap" },
      { ...sortable("category", t("column.category")), width: "w-32 whitespace-nowrap" },
      { key: "text", header: t("field.decisionText"), width: "w-[42%]" },
      { key: "description", header: t("field.decisionDescription"), width: "w-[32%]" },
      { ...sortable("status", t("column.status")), width: "w-28 whitespace-nowrap" },
    ];
    rows = result.rows.map((row) => ({
      id: row.id,
      version: row.version,
      href: `${BASE}/rulings/${row.id}`,
      editHref: `${BASE}/rulings/${row.id}/edit`,
      /* A ruling has no name, so its first line stands for it in a
         confirmation — the same thing its record header uses. */
      label: (row.decisionText ?? "").slice(0, 80),
      cells: {
        meeting: meetingCell(row.meetingNumber, row.meetingDate),
        category: chip("decision_report_categories", row.reportCategory),
        status: chip("council_review_statuses", row.reviewStatus),
        /*
         * Clamped on purpose — a ruling is a paragraph and this register holds
         * one of nearly a thousand characters, so twenty unclamped rows is not
         * a table. Not a dead end either: the row opens a record that prints it
         * entire.
         */
        text: { text: row.decisionText },
        description: { text: row.decisionDescription },
      },
    }));
  } else if (tab === "appointments") {
    const appointments = await readAppointments(viewer.tenantId, query);
    result = appointments;
    deleteAction = deleteAppointments;
    addHref = `${BASE}/appointments/new`;
    icon = UserCheck;
    /*
     * Three seats, three columns. This register exists to answer «who was
     * appointed to supervise whom», so the three appointments are the point of
     * the row; folded into one cell with a second line, the third seat is
     * invisible and a fully-staffed appointment looks like a half-staffed one.
     */
    columns = [
      { ...sortable("meeting", t("column.meeting")), width: "w-28 whitespace-nowrap" },
      { ...sortable("student", t("column.student")), width: "w-44" },
      { ...sortable("placement", t("column.placement")), width: "w-[22%]" },
      { key: "first", header: t("field.primarySupervisor"), width: "w-[20%]" },
      { key: "second", header: t("field.secondarySupervisor"), width: "w-[20%]" },
      { key: "third", header: t("field.thirdSupervisor"), width: "w-[20%]" },
    ];
    rows = appointments.rows.map((row) => ({
      id: row.id,
      version: row.version,
      href: `${BASE}/appointments/${row.id}`,
      editHref: `${BASE}/appointments/${row.id}/edit`,
      label: row.studentName ?? "",
      cells: {
        meeting: meetingCell(row.meetingNumber, row.meetingDate),
        student: {
          text: row.studentName,
          secondary: row.studentNumber ? toLocaleDigits(row.studentNumber, locale) : null,
        },
        placement: {
          text: label("degrees", row.educationLevel),
          secondary: label("fields_of_study", row.fieldOfStudy),
        },
        /*
         * The seats hold professor ids and show the name read from the live
         * directory — an appointment is a pointer, not a document, so a
         * professor who is renamed is renamed here too.
         */
        first: { text: row.primarySupervisor },
        second: { text: row.secondarySupervisor },
        third: { text: row.thirdSupervisor },
      },
    }));
  } else {
    /* Held in its own binding as well as the shared one: `result` is declared
       as the union of three page shapes, and reading a decision's own columns
       off it would need a narrowing TypeScript cannot perform on a `let`. */
    const decisions = await readDecisions(viewer.tenantId, query);
    result = decisions;
    deleteAction = deleteDecisions;
    addHref = `${BASE}/new`;
    icon = Scale;
    /*
     * ── Three panels, not two abbreviated ones ──────────────────────────────
     *
     * The board is eleven seats and this register is where the office checks
     * whether a case has one. Supervisors and advisors are separate columns
     * because they are separate offices — راهنما directs the work, مشاور
     * advises on it — and a cell that showed one supervisor with a second on a
     * quiet line beneath it made a three-supervisor case indistinguishable
     * from a two-supervisor one.
     */
    columns = [
      { ...sortable("meeting", t("column.meeting")), width: "w-28 whitespace-nowrap" },
      { ...sortable("student", t("column.student")), width: "w-40" },
      { ...sortable("category", t("column.category")), width: "w-28 whitespace-nowrap" },
      { ...sortable("placement", t("column.placement")), width: "w-[18%]" },
      { key: "supervisors", header: t("column.supervisors"), width: "w-[20%]" },
      { key: "advisors", header: t("column.advisors"), width: "w-[18%]" },
      { key: "reviewers", header: t("column.reviewers"), width: "w-[18%]" },
      { ...sortable("status", t("column.status")), width: "w-28 whitespace-nowrap" },
    ];
    rows = decisions.rows.map((row) => ({
      id: row.id,
      version: row.version,
      href: `${BASE}/${row.id}`,
      editHref: `${BASE}/${row.id}/edit`,
      label: row.studentName ?? row.thesisTitle ?? "",
      cells: {
        meeting: meetingCell(row.meetingNumber, row.meetingDate),
        student: {
          text: row.studentName,
          secondary: row.studentNumber ? toLocaleDigits(row.studentNumber, locale) : null,
        },
        placement: {
          text: label("degrees", row.educationLevel),
          secondary: label("fields_of_study", row.fieldOfStudy),
        },
        category: chip("ruling_report_categories", row.reportCategory),
        status: chip("council_review_statuses", row.reviewStatus),
        supervisors: {
          text: null,
          list: [row.primarySupervisor, row.secondarySupervisor, row.thirdSupervisor],
        },
        advisors: {
          text: null,
          list: [row.firstAdvisor, row.secondAdvisor, row.thirdAdvisor],
        },
        reviewers: {
          text: null,
          list: [row.reviewer1, row.reviewer2, row.reviewer3, row.reviewer4Invited],
          /*
           * The graduate-studies representative sits on the panel but is not an
           * examiner like the others. Left out of the column entirely, a panel
           * of four printed as three.
           */
          distinct: {
            name: row.graduateStudiesRepresentative,
            label: t("field.graduateStudiesRepresentative"),
          },
        },
      },
    }));
  }

  const filters: RegisterFilterView[] = spec.filters.map((filter) => {
    const current = query.filters[filter.key] ?? null;
    /* Every filter on this register is backed by a vocabulary; the empty list
       is the honest answer for a `set: null` one, which none of them has. */
    const entries = (filter.set === null ? undefined : lookups.get(filter.set)) ?? [];
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
        href: withTab(filterHref(spec, query, filter.key, entry.value, open)),
      })),
      clearHref: withTab(filterHref(spec, query, filter.key, null, open)),
    };
  });

  const Icon = icon;

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: t("title") }]}
      />

      <RegisterTabs
        countLabel={t("title")}
        tabs={DECISION_TABS.map((key) => ({
          key,
          label: t(`tab.${key}`),
          // The bare tab, dropping this register's query — see `RegisterTabs`.
          href: key === "decisions" ? BASE : `${BASE}?tab=${key}`,
          count: toLocaleDigits(String(counts[key]), locale),
          active: key === tab,
        }))}
      />

      <RegisterView
        columns={columns}
        rows={rows}
        filters={filters}
        filtersShown={filtersShown}
        toggleFiltersHref={withTab(queryHref(spec, query, {}, { filtersOpen: !filtersShown }))}
        clearHref={withTab(BASE)}
        narrowed={narrowed}
        matched={result.total}
        registerSize={counts[tab]}
        unit={words("count")}
        canManage={canManage}
        /*
         * Only the decisions register exports. The other two are small, and a
         * command that produces a file of forty rows is a command that mostly
         * teaches people the button does nothing useful.
         */
        canExport={tab === "decisions" && can(viewer, "data.export")}
        reportsHref="/council-decisions/reports"
        exportHref={queryHref({ ...spec, basePath: `${BASE}/export` }, query)}
        addHref={addHref}
        addLabel={words("add")}
        /*
         * Import belongs to the decisions tab alone.
         *
         * An import matches a row to a record by a stable key, and only this
         * one has one — the thesis code. A ruling is a paragraph of free text
         * with nothing to match on, so every run of the same file would create
         * the whole set again; an appointment is identified by a student and a
         * sitting together, which is not a column. A command that silently
         * duplicated a register on its second press is worse than no command.
         */
        importSlot={
          tab === "decisions" && canManage ? (
            <ImportDialog
              key="decision-import"
              plan={planDecisionImport}
              apply={importDecisions}
              rollback={rollbackDecisionImport}
              maxBytes={MAX_IMPORT_BYTES}
              limit={IMPORT_LIMIT}
            />
          ) : null
        }
        deleteAction={deleteAction}
        /*
         * Both are documents, so both go in the report group beside «صادرات» —
         * the other command on this strip that takes the register out of the
         * application. Real links, so either opens in a second tab beside the
         * register it was produced from.
         */
        reportActions={
          <Fragment key="decision-reports">
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
            query={queryHref(spec, query, {}, open).split("?")[1] ?? ""}
            views={savedViews}
            saveAction={saveView}
            deleteAction={deleteView}
            canPublish={can(viewer, "saved-views.publish")}
          />
        }
        searchSlot={
          <RegisterSearch
            spec={spec}
            query={query}
            placeholder={words("searchPlaceholder")}
            label={common("search")}
          />
        }
        emptySlot={
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{narrowed ? t("emptyFiltered") : words("empty")}</EmptyTitle>
              <EmptyDescription>
                {narrowed ? t("emptyFilteredHint") : words("emptyHint")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {narrowed ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={withTab(BASE)}>{t("clearFilters")}</Link>}
                />
              ) : canManage ? (
                <Button nativeButton={false} render={<Link href={addHref}>{words("add")}</Link>} />
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
            sizeHrefFor={(size) => withTab(pageSizeHref(spec, query, size, open))}
            hrefFor={(page) => withTab(queryHref(spec, query, { page }, open))}
            previousHref={
              result.previousCursor
                ? withTab(cursorHref(spec, query, result.previousCursor, result.page - 1, open))
                : null
            }
            nextHref={
              result.nextCursor
                ? withTab(cursorHref(spec, query, result.nextCursor, result.page + 1, open))
                : null
            }
          />
        }
      />
    </PageBody>
  );
}
