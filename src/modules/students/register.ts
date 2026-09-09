import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { lookups, professors, students } from "@/db/schema.ts";
import { readOnly, type TenantTx } from "@/db/tenant.ts";
import { lookupTableInTx } from "@/lib/lookups.ts";
import { decodeRegisterCursor, encodeRegisterCursor } from "@/lib/register/cursor.ts";
import { directionalKeysetBoundary, directionalKeysetOrder } from "@/lib/register/keyset.ts";
import { readSavedViewsInTx } from "@/lib/register/saved-views.ts";
import { cursorValues, directionalOrderFor } from "@/lib/register/sort-order.ts";
import type { RegisterPage, RegisterQuery } from "@/lib/register/spec.ts";
import { FILTERS, type RegisterRow } from "./model.ts";

export * from "./model.ts";

/**
 * The student register's one read.
 *
 * Search, filters, sort and page, resolved in a single statement against the
 * database — not fetched and then narrowed in JavaScript. That distinction is
 * the entire reason this file exists: a register holds tens of thousands of
 * people, and "load them all and filter" is a design that works on the seed data
 * and falls over on the archive.
 */

/** The column each filter compares against. */
const FILTER_COLUMN = {
  degree: students.degree,
  status: students.status,
  faculty: students.faculty,
  department: students.department,
  field: students.fieldOfStudy,
  gender: students.gender,
} as const;

/*
 * RLS remains the authority. Repeating its tenant predicate in the statement
 * is an intentional planner hint, not a second authorization mechanism: it
 * lets PostgreSQL combine the tenant access path with the register filters
 * instead of evaluating a non-leakproof LIKE predicate above the RLS barrier.
 */
const TENANT_SCOPE = sql`${students.tenantId} = app.current_tenant()`;

/**
 * A supervisor's name, assembled in SQL rather than fetched separately.
 *
 * Three joins against the same table, so each needs its own alias. The
 * alternative — read the ids, then read the professors, then stitch them in
 * JavaScript — is four round trips per page and a name that is missing whenever
 * the second query races the first.
 */
function professorName(table: ReturnType<typeof alias<typeof professors, string>>): SQL<string> {
  return sql<string>`nullif(btrim(coalesce(${table.firstName}, '') || ' ' || coalesce(${table.lastName}, '')), '')`;
}

/**
 * How many records the register holds, ignoring the current query.
 *
 * The denominator in «۱۰ نفر از ۲۶». Separate from the result's own total
 * because it answers a different question — that one is "how many matched", this
 * one is "out of how many" — and a filter that caught 10 of 26 and one that
 * caught 10 of 40,000 look identical without it.
 *
 * `count(*)` over one indexed predicate, on a table already scoped to one
 * institution by row-level security.
 */
export async function registerSizeInTx(tx: TenantTx): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(students)
    .where(and(TENANT_SCOPE, isNull(students.deletedAt)));
  return row?.total ?? 0;
}

export async function registerSize(tenantId: string): Promise<number> {
  return readOnly(tenantId, registerSizeInTx);
}

/**
 * The whole matching set, for a file rather than a page.
 *
 * Shares the query's filters and search with `readRegister` and drops its
 * paging, because an export of "page 3" is not a thing anybody asks for.
 *
 * Capped at 20,000 rows. That is not a guess about how many students a
 * university has — it is the point past which the request stops being a download
 * and becomes a way to hold a pooled connection while PostgreSQL materialises
 * the archive. An institution with more than that needs a background job that
 * writes a file, which is a different feature with a different shape.
 */
export const EXPORT_LIMIT = 20_000;

export async function exportRegisterSize(tenantId: string, query: RegisterQuery): Promise<number> {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(students)
      .where(and(...registerConditions(query))),
  );
  return row?.total ?? 0;
}

export async function exportRegister(tenantId: string, query: RegisterQuery) {
  return readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(students)
      .where(and(...registerConditions(query)))
      .orderBy(asc(students.lastName), asc(students.firstName), asc(students.id))
      .limit(EXPORT_LIMIT),
  );
}

/**
 * What narrows the register — the search and the filters, without the paging.
 *
 * Shared by the screen and the export, deliberately: two copies of this drift,
 * and the way they drift is that somebody adds a filter to the register and the
 * file quietly keeps exporting the unnarrowed set. A clerk who filtered to
 * eleven records and received four thousand would be right to distrust every
 * export after it.
 */
export function registerConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [
    TENANT_SCOPE,
    /*
     * Retired records are out of the register.
     *
     * Row-level security has already narrowed this to one institution; it has no
     * opinion about whether a record is current, and it should not — «حذف» here
     * is a business decision the register makes and the archive screen reverses.
     */
    isNull(students.deletedAt),
  ];

  if (query.search.trim()) {
    /*
     * The needle folded by the same function that built the haystack.
     *
     * `app.fold_text` on both sides is not belt and braces — it is the only
     * thing that makes the two comparable. Folding the column and comparing a
     * raw needle would mean a search typed on an Arabic keyboard never matched a
     * record filed from a Persian one, which is the failure the column exists to
     * prevent.
     *
     * One `LIKE` per typed *word*, ANDed: «سهیل باق» must find «سهیل باقریان
     * زکریا», and a single needle containing a space cannot, because the folded
     * column separates its parts with that same space in a different order.
     */
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      conditions.push(sql`${students.searchText} LIKE '%' || app.fold_text(${word}) || '%'`);
    }
  }

  for (const filter of FILTERS) {
    const value = query.filters[filter.key];
    if (value) conditions.push(eq(FILTER_COLUMN[filter.key], value));
  }

  return conditions;
}

export async function readRegisterInTx(
  tx: TenantTx,
  query: RegisterQuery,
  options: { includeNationalId?: boolean } = {},
): Promise<RegisterPage<RegisterRow>> {
  const nationalId = options.includeNationalId ? students.nationalId : sql<string | null>`null`;
  const primary = alias(professors, "supervisor_primary");
  const secondary = alias(professors, "supervisor_secondary");
  const advisor = alias(professors, "advisor");

  const conditions = registerConditions(query);
  const byVocabulary = (column: AnyPgColumn, set: string) =>
    sql<number>`coalesce((select ${lookups.position} from ${lookups}
         where ${lookups.set} = ${set} and ${lookups.value} = ${column}
         limit 1), 2147483647)`.mapWith(Number);
  const textOrder = (column: AnyPgColumn) => sql<string>`coalesce(${column}, '')`;

  const orders: Record<string, SQL[]> = {
    studentNumber: [textOrder(students.studentNumber)],
    name: [textOrder(students.lastName), textOrder(students.firstName)],
    degree: [byVocabulary(students.degree, "degrees")],
    status: [byVocabulary(students.status, "student_statuses")],
    placement: [
      byVocabulary(students.department, "departments"),
      byVocabulary(students.fieldOfStudy, "fields_of_study"),
    ],
  };
  const directionalOrder = directionalOrderFor(orders, query, "name");
  const order = directionalOrder.map((entry) => entry.column as SQL);

  const decoded = decodeRegisterCursor(query, query.cursor ?? "", directionalOrder.length);
  const cursor = decoded?.values.every((value) => value !== null)
    ? { ...decoded, values: decoded.values as (string | number)[] }
    : null;
  const boundary = cursor
    ? directionalKeysetBoundary(
        directionalOrder,
        cursor.values,
        students.id,
        cursor.id,
        cursor.mode,
      )
    : undefined;
  const page = cursor ? cursor.page : query.cursor ? 1 : Math.max(1, query.page);
  const offset = cursor || query.cursor ? 0 : (page - 1) * query.size;
  const physicalOrder = directionalKeysetOrder(directionalOrder, students.id, cursor?.mode ?? null);

  const fetched = await tx
    .select({
      id: students.id,
      studentNumber: students.studentNumber,
      nationalId,
      firstName: students.firstName,
      lastName: students.lastName,
      gender: students.gender,
      degree: students.degree,
      status: students.status,
      faculty: students.faculty,
      department: students.department,
      fieldOfStudy: students.fieldOfStudy,
      primarySupervisor: professorName(primary),
      secondarySupervisor: professorName(secondary),
      advisor: professorName(advisor),
      version: students.version,
      total: sql<number>`count(*) over()`.mapWith(Number),
      cursor0: order[0] ?? sql<string>`''`,
      cursor1: order[1] ?? sql<string>`''`,
      cursor2: order[2] ?? sql<string>`''`,
      cursor3: order[3] ?? sql<string>`''`,
      cursor4: order[4] ?? sql<string>`''`,
      cursor5: order[5] ?? sql<string>`''`,
    })
    .from(students)
    .leftJoin(primary, eq(primary.id, students.primarySupervisorId))
    .leftJoin(secondary, eq(secondary.id, students.secondarySupervisorId))
    .leftJoin(advisor, eq(advisor.id, students.advisorId))
    .where(and(...conditions, ...(boundary ? [boundary] : [])))
    .orderBy(...physicalOrder)
    .limit(query.size + 1)
    .offset(offset);

  if (fetched.length === 0 && page > 1 && !cursor) {
    return readRegisterInTx(tx, { ...query, page: 1, cursor: "" }, options);
  }

  const physicalPage = fetched.slice(0, query.size);
  const displayPage = cursor?.mode === "before" ? [...physicalPage].reverse() : physicalPage;
  const total = cursor?.total ?? fetched[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / query.size));

  const valuesFor = (row: (typeof displayPage)[number]): (string | number)[] =>
    cursorValues(
      [row.cursor0, row.cursor1, row.cursor2, row.cursor3, row.cursor4, row.cursor5],
      directionalOrder.length,
    );
  const first = displayPage[0];
  const last = displayPage.at(-1);

  const previousCursor =
    first && page > 1
      ? encodeRegisterCursor(query, {
          mode: "before",
          page: page - 1,
          total,
          values: valuesFor(first),
          id: first.id,
        })
      : null;
  const hasNext = cursor?.mode === "before" ? page < pages : fetched.length > query.size;
  const nextCursor =
    last && hasNext
      ? encodeRegisterCursor(query, {
          mode: "after",
          page: page + 1,
          total,
          values: valuesFor(last),
          id: last.id,
        })
      : null;

  return {
    rows: displayPage.map(({ total: _total, cursor0: _cursor0, cursor1: _cursor1, ...row }) => row),
    total,
    pages,
    page,
    nextCursor,
    previousCursor,
    cursorMode: Boolean(cursor || nextCursor || previousCursor),
  };
}
export async function readRegister(
  tenantId: string,
  query: RegisterQuery,
  options: { includeNationalId?: boolean } = {},
): Promise<RegisterPage<RegisterRow>> {
  return readOnly(tenantId, (tx) => readRegisterInTx(tx, query, options));
}
/**
 * Page-level student register data in one tenant transaction. Keeping this in
 * the domain layer preserves the route/module boundary while avoiding four
 * independent RLS/timezone setup transactions for one request.
 */
export async function readStudentsPageData(
  tenantId: string,
  userId: string,
  basePath: string,
  query: RegisterQuery,
  lookupSets: readonly string[],
  options: { includeNationalId?: boolean } = {},
) {
  return readOnly(tenantId, async (tx) => {
    /* Drizzle transactions share one pg Client. These reads belong to one
       consistent snapshot, but cannot safely run concurrently on that client. */
    const result = await readRegisterInTx(tx, query, options);
    const lookups = await lookupTableInTx(tx, lookupSets);
    const total = await registerSizeInTx(tx);
    const savedViews = await readSavedViewsInTx(tx, userId, basePath);
    return { result, lookups, total, savedViews };
  });
}
