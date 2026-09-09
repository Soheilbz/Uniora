import { Award, BadgeCheck, GraduationCap, Users } from "lucide-react";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
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
import { PageBody } from "@/components/page-header";
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
import { PAGE_SIZES, type RegisterSpec } from "@/lib/register/spec.ts";
import { requireModule } from "@/lib/viewer.ts";
import {
  deleteWorkshops,
  importWorkshops,
  planWorkshopImport,
  rollbackWorkshopImport,
} from "@/modules/workshops/actions.ts";
import {
  isWorkshopTab,
  REGISTER_FOR_TAB,
  WORKSHOP_LOOKUP_SETS,
  WORKSHOP_TABS,
  type WorkshopTab,
} from "@/modules/workshops/model.ts";
import { readWorkshops, workshopRegisterSize } from "@/modules/workshops/queries.ts";
import {
  readCertificates,
  readInstructors,
  readParticipants,
  workshopTabCounts,
} from "@/modules/workshops/registers.ts";

/**
 * What this office has run, and for whom — four registers on one screen.
 *
 * The workshops themselves, the people who taught them, the people who attended
 * them, and the certificates that came out of it. Four tables, one question:
 * somebody looking for a name does not know in advance which of the four it is
 * filed under, and a guest who taught in March and attended in June is on two.
 *
 * The three after the first read the *other* axis from a workshop's own record.
 * That record already lists its instructors and its attendees; what these add is
 * «every certificate this year» and «has this person ever been on a register at
 * all», which no amount of opening one workshop at a time will answer.
 *
 * ── The strip drops the rest of the query ───────────────────────────────────
 *
 * A tab's href is the bare tab. The four are four different tables, so carrying
 * `?payment=unpaid` into the certificate register would apply a filter to a
 * table with no such column, and page eleven of one is not page eleven of
 * another. See `RegisterTabs`, which is links rather than a client tab strip so
 * that «the certificates» is something an office can bookmark and send.
 */

export async function generateMetadata() {
  const t = await getTranslations("workshops");
  return { title: t("title") };
}

const BASE = "/workshops";

export default async function WorkshopsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { viewer } = await requireModule(BASE);
  const params = await searchParams;

  /* A hand-edited or stale tab falls back to the first one rather than to four
     empty panels — the same rule the decisions screen follows. */
  const tab: WorkshopTab = isWorkshopTab(params.tab) ? params.tab : "workshops";
  const spec: RegisterSpec = REGISTER_FOR_TAB[tab];
  const query = readQuery(spec, params);

  const [lookups, counts, format, locale, t, common, savedViews] = await Promise.all([
    lookupTable(viewer.tenantId, WORKSHOP_LOOKUP_SETS),
    workshopTabCounts(viewer.tenantId),
    getFormatter(),
    getLocale(),
    getTranslations("workshops"),
    getTranslations("common"),
    readSavedViews(viewer.tenantId, viewer.userId, BASE),
  ]);

  const canManage = can(viewer, "workshops.manage");
  const narrowed = isNarrowed(query);
  const filtersShown = filtersOpen(params, query);
  const open = { filtersOpen: filtersShown };

  /** The tab's own address, with nothing else on it. */
  const tabHref = (key: WorkshopTab) => (key === "workshops" ? BASE : `${BASE}?tab=${key}`);

  const strip = (
    <RegisterTabs
      countLabel={t("title")}
      tabs={WORKSHOP_TABS.map((key) => ({
        key,
        label: t(`tab.${key}`),
        href: tabHref(key),
        count: toLocaleDigits(String(counts[key]), locale),
        active: key === tab,
      }))}
    />
  );

  const sortable = (key: string, header: string): RegisterColumn => ({
    key,
    header,
    sortKey: key,
    nextSortDirection: query.sort === key && query.direction === "asc" ? "desc" : "asc",
    sortHref: queryHref(
      spec,
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

  const chip = (set: string, value: string | null) => {
    if (!value) return { text: null };
    const entries = lookups.get(set) ?? [];
    const index = entries.findIndex((entry) => entry.value === value);
    return index < 0 ? { text: value } : { text: entries[index]?.label ?? value, tone: index };
  };

  const label = (set: string, value: string | null) =>
    value ? (lookups.get(set)?.find((entry) => entry.value === value)?.label ?? value) : null;

  const dated = (value: string | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium" }) : null;

  /** The filter strip for whichever register is open. */
  const filtersFor = (labelFor: (key: string) => string): RegisterFilterView[] =>
    spec.filters.map((filter) => {
      const current = query.filters[filter.key] ?? null;
      const entries = (filter.set === null ? undefined : lookups.get(filter.set)) ?? [];
      return {
        key: filter.key,
        label: labelFor(filter.key),
        value: current,
        valueLabel: current
          ? (entries.find((entry) => entry.value === current)?.label ?? current)
          : null,
        options: entries.map((entry) => ({
          value: entry.value,
          label: entry.label,
          href: filterHref(spec, query, filter.key, entry.value, open),
        })),
        clearHref: filterHref(spec, query, filter.key, null, open),
      };
    });

  /**
   * Everything the four registers share.
   *
   * `matched`, `registerSize` and the rows differ; the toolbar, the pager and
   * the search box are built the same way for all of them, so they are built
   * once. A tab whose pager computed its pages differently from its neighbour
   * would be a bug nobody would think to look for.
   */
  const shell = (options: {
    columns: RegisterColumn[];
    rows: RegisterViewRow[];
    filters: RegisterFilterView[];
    matched: number;
    size: number;
    unit: string;
    placeholder: string;
    result: {
      page: number;
      pages: number;
      rows: unknown[];
      previousCursor?: string | null;
      nextCursor?: string | null;
    };
    empty: { icon: React.ReactNode; title: string; hint: string };
    /** Only the workshops register writes; the other three are views. */
    manage?: React.ReactNode;
  }) => (
    <RegisterView
      columns={options.columns}
      rows={options.rows}
      filters={options.filters}
      filtersShown={filtersShown}
      toggleFiltersHref={queryHref(spec, query, {}, { filtersOpen: !filtersShown })}
      clearHref={tabHref(tab)}
      narrowed={narrowed}
      matched={options.matched}
      registerSize={options.size}
      unit={options.unit}
      /*
       * The three cross-workshop registers carry no record group.
       *
       * They are views of rows that belong to a workshop, and a row is created,
       * corrected and removed on that workshop's own record — where the person
       * doing it can see the capacity, the attendance and the certificate
       * together. An «افزودن» here would have to ask which workshop first, and
       * a «حذف گروهی» would remove seats from forty registers at once.
       */
      canManage={tab === "workshops" ? canManage : false}
      canExport={can(viewer, "data.export")}
      reportsHref="/workshops/reports"
      /*
       * The register on screen, narrowed as it is — «who has not paid» exports
       * as that list and not as everybody.
       *
       * The tab is appended rather than passed through `queryHref`, which emits
       * only the keys this register's spec declares as filters: a `tab` smuggled
       * in among them is silently dropped, and the file that came back was the
       * workshops every time.
       */
      exportHref={
        queryHref({ ...spec, basePath: `${BASE}/export` }, query) +
        (tab === "workshops" ? "" : `${query.search || narrowed ? "&" : "?"}tab=${tab}`)
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
          placeholder={options.placeholder}
          label={common("search")}
        />
      }
      emptySlot={
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">{options.empty.icon}</EmptyMedia>
            <EmptyTitle>{narrowed ? t("across.nothingFound") : options.empty.title}</EmptyTitle>
            <EmptyDescription>
              {narrowed ? t("across.nothingFoundHint") : options.empty.hint}
            </EmptyDescription>
          </EmptyHeader>
          {narrowed && (
            <EmptyContent>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={tabHref(tab)}>{t("clearFilters")}</Link>}
              />
            </EmptyContent>
          )}
        </Empty>
      }
      footerSlot={
        <Pager
          page={options.result.page}
          pages={options.result.pages}
          total={options.matched}
          shown={options.result.rows.length}
          size={query.size}
          sizes={PAGE_SIZES}
          sizeHrefFor={(size) => pageSizeHref(spec, query, size, open)}
          hrefFor={(page) => queryHref(spec, query, { page }, open)}
          previousHref={
            options.result.previousCursor
              ? cursorHref(
                  spec,
                  query,
                  options.result.previousCursor,
                  options.result.page - 1,
                  open,
                )
              : null
          }
          nextHref={
            options.result.nextCursor
              ? cursorHref(spec, query, options.result.nextCursor, options.result.page + 1, open)
              : null
          }
        />
      }
      {...(options.manage ? { importSlot: options.manage } : {})}
      {...(tab === "workshops"
        ? {
            addHref: `${BASE}/new`,
            addLabel: t("add"),
            deleteAction: deleteWorkshops,
          }
        : {})}
    />
  );

  if (tab === "instructors") {
    const canSeeNationalId = can(viewer, "students.nationality");
    const result = await readInstructors(viewer.tenantId, query, undefined, {
      includeNationalId: canSeeNationalId,
    });
    const rows: RegisterViewRow[] = result.rows.map((row) => ({
      id: row.id,
      /* The workshop, not the instructor: this row *is* a seat on that
         workshop, and the record that explains it is the workshop's. */
      href: `${BASE}/${row.workshopId}`,
      editHref: `${BASE}/${row.workshopId}`,
      label: row.name,
      cells: {
        name: {
          text: row.name,
          /* A staff instructor links to the directory; a guest has no record to
             link to, so their identity number is what identifies them. */
          secondary:
            canSeeNationalId && row.nationalId ? toLocaleDigits(row.nationalId, locale) : null,
        },
        workshop: { text: row.workshopTitle, secondary: dated(row.workshopDate) },
        role: chip("instructor_roles", row.role),
        affiliation: { text: row.affiliation },
      },
    }));

    return (
      <PageBody>
        <h1 className="sr-only">{t("title")}</h1>
        {strip}
        {shell({
          columns: [
            { ...sortable("name", t("column.person")), locked: true },
            sortable("workshop", t("column.workshop")),
            sortable("role", t("column.role")),
            { key: "affiliation", header: t("column.affiliation") },
          ],
          rows,
          filters: filtersFor((key) => t(`field.${key}`)),
          matched: result.total,
          size: counts.instructors,
          unit: t("across.instructorCount"),
          placeholder: t("across.instructorSearch"),
          result,
          empty: {
            icon: <GraduationCap aria-hidden />,
            title: t("across.noInstructors"),
            hint: t("across.noInstructorsHint"),
          },
        })}
      </PageBody>
    );
  }

  if (tab === "participants") {
    const canSeeNationalId = can(viewer, "students.nationality");
    const result = await readParticipants(viewer.tenantId, query, undefined, {
      includeNationalId: canSeeNationalId,
    });
    const rows: RegisterViewRow[] = result.rows.map((row) => ({
      id: row.id,
      href: `${BASE}/${row.workshopId}`,
      editHref: `${BASE}/${row.workshopId}`,
      label: row.name,
      cells: {
        name: {
          text: row.name,
          secondary: row.studentNumber
            ? toLocaleDigits(row.studentNumber, locale)
            : canSeeNationalId && row.nationalId
              ? toLocaleDigits(row.nationalId, locale)
              : row.affiliation,
        },
        workshop: { text: row.workshopTitle, secondary: dated(row.workshopDate) },
        registered: { text: dated(row.registrationDate) },
        attendance: chip("attendance_statuses", row.attendanceStatus),
        payment: chip("payment_statuses", row.paymentStatus),
        certificate: {
          /*
           * The number where one was issued, and «صادر نشده» where none was.
           *
           * Not an empty cell: a blank reads as «not recorded», and whether a
           * certificate exists is precisely the fact this column is for — it is
           * the thing an attendee rings up about.
           */
          text: row.certificateNumber
            ? toLocaleDigits(row.certificateNumber, locale)
            : t("notIssued"),
          ltr: Boolean(row.certificateNumber),
        },
        contact: { text: row.mobile ? toLocaleDigits(row.mobile, locale) : null, ltr: true },
      },
    }));

    return (
      <PageBody>
        <h1 className="sr-only">{t("title")}</h1>
        {strip}
        {shell({
          columns: [
            { ...sortable("name", t("column.person")), locked: true },
            sortable("workshop", t("column.workshop")),
            sortable("registered", t("column.registered")),
            sortable("attendance", t("attendance")),
            sortable("payment", t("column.payment")),
            { key: "certificate", header: t("certificate") },
            { key: "contact", header: t("column.contact") },
          ],
          rows,
          filters: filtersFor((key) =>
            key === "attendance" ? t("attendance") : t("column.payment"),
          ),
          matched: result.total,
          size: counts.participants,
          unit: t("across.participantCount"),
          placeholder: t("across.participantSearch"),
          result,
          empty: {
            icon: <Users aria-hidden />,
            title: t("across.noParticipants"),
            hint: t("across.noParticipantsHint"),
          },
        })}
      </PageBody>
    );
  }

  if (tab === "certificates") {
    const result = await readCertificates(viewer.tenantId, query);
    const rows: RegisterViewRow[] = result.rows.map((row) => ({
      id: row.id,
      ...(row.workshopRetired
        ? { href: `${BASE}/certificates/${row.id}/print` }
        : { href: `${BASE}/certificates/${row.id}/print`, editHref: `${BASE}/${row.workshopId}` }),
      label: row.certificateNumber,
      cells: {
        number: { text: toLocaleDigits(row.certificateNumber, locale), ltr: true },
        name: { text: row.name },
        workshop: { text: row.workshopTitle, secondary: dated(row.workshopDate) },
        issued: { text: dated(row.issueDate) },
        /*
         * The verification code, shown.
         *
         * It is printed on the certificate and its whole job is to be compared
         * with what somebody is holding — an office asked «is this genuine»
         * needs to read it off the screen. It is not a secret: it is unguessable,
         * which is a different property, and hiding it here would only mean
         * opening the workshop record to do the one thing it exists for.
         */
        verification: { text: row.verificationCode, ltr: true },
      },
    }));

    return (
      <PageBody>
        <h1 className="sr-only">{t("title")}</h1>
        {strip}
        {shell({
          columns: [
            { ...sortable("number", t("column.number")), locked: true },
            sortable("name", t("column.person")),
            sortable("workshop", t("column.workshop")),
            sortable("issued", t("issued")),
            { key: "verification", header: t("column.verification") },
          ],
          rows,
          filters: filtersFor((key) => t(`field.${key}`)),
          matched: result.total,
          size: counts.certificates,
          unit: t("across.certificateCount"),
          placeholder: t("across.certificateSearch"),
          result,
          empty: {
            icon: <BadgeCheck aria-hidden />,
            title: t("across.noCertificates"),
            hint: t("across.noCertificatesHint"),
          },
        })}
      </PageBody>
    );
  }

  /* ── The workshops themselves ───────────────────────────────────────────── */

  const [result, size] = await Promise.all([
    readWorkshops(viewer.tenantId, query),
    workshopRegisterSize(viewer.tenantId),
  ]);

  const rows: RegisterViewRow[] = result.rows.map((row) => ({
    id: row.id,
    version: row.version,
    href: `${BASE}/${row.id}`,
    editHref: `${BASE}/${row.id}/edit`,
    label: row.title,
    cells: {
      title: { text: row.title },
      workshopDate: { text: dated(row.workshopDate) },
      duration: {
        text: row.durationHours
          ? t("hours", { hours: format.number(Number(row.durationHours)) })
          : null,
      },
      place: { text: label("workshop_locations", row.locationType), secondary: row.venue },
      capacity: { text: row.capacity > 0 ? format.number(row.capacity) : null, ltr: true },
      enrolment: {
        /*
         * «۴ از ۶» — attended of registered, in one cell.
         *
         * The word, not a slash: `/` is in common use as a decimal separator in
         * Iran, so «۴/۶» reads as *four point six* rather than as a proportion.
         * And it is genuinely an "of" relation — four of the six who signed up
         * turned up — which is the number the office is actually looking for.
         */
        text: `${format.number(row.attended)} ${common("outOf")} ${format.number(row.registered)}`,
      },
      certificates: {
        text: row.certificates > 0 ? format.number(row.certificates) : null,
        ltr: true,
      },
      status: chip("workshop_statuses", row.status),
    },
  }));

  return (
    <PageBody>
      <h1 className="sr-only">{t("title")}</h1>
      {strip}
      {shell({
        columns: [
          /* The row's identity — a workshop is its title. */
          { ...sortable("title", t("column.title")), locked: true, width: "w-[28%]" },
          { ...sortable("workshopDate", t("column.date")), width: "w-28 whitespace-nowrap" },
          { key: "duration", header: t("column.duration"), width: "w-24 whitespace-nowrap" },
          { key: "place", header: t("column.place"), width: "w-[22%]" },
          { ...sortable("capacity", t("field.capacity")), width: "w-20 whitespace-nowrap" },
          { key: "enrolment", header: t("column.enrolment"), width: "w-24 whitespace-nowrap" },
          {
            key: "certificates",
            header: t("column.certificates"),
            width: "w-20 whitespace-nowrap",
          },
          { key: "status", header: t("field.status"), width: "w-24 whitespace-nowrap" },
        ],
        rows,
        filters: filtersFor((key) => t(`field.${key}`)),
        matched: result.total,
        size,
        unit: t("count"),
        placeholder: t("searchPlaceholder"),
        result,
        empty: {
          icon: <Award aria-hidden />,
          title: t("empty"),
          hint: t("emptyHint"),
        },
        manage: canManage ? (
          <ImportDialog
            key="workshop-import"
            plan={planWorkshopImport}
            apply={importWorkshops}
            rollback={rollbackWorkshopImport}
            maxBytes={MAX_IMPORT_BYTES}
            limit={IMPORT_LIMIT}
          />
        ) : null,
      })}
    </PageBody>
  );
}
