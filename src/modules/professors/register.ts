import { and, asc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { cache } from "react";
import { councilDecisions, professors, students } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { decodeRegisterCursor, encodeRegisterCursor } from "@/lib/register/cursor.ts";
import { directionalKeysetBoundary, directionalKeysetOrder } from "@/lib/register/keyset.ts";
import { cursorValues, directionalOrderFor } from "@/lib/register/sort-order.ts";
import type { RegisterPage, RegisterQuery } from "@/lib/register/spec.ts";
import { FILTERS, type ProfessorRow } from "./model.ts";

export * from "./model.ts";

/**
 * The professor register's one read.
 *
 * Search, filters, sort and page resolved in a single statement — not fetched
 * and then narrowed in JavaScript, for the reason the student register gives:
 * "load them all and filter" is a design that works on the seed and falls over
 * on the archive.
 */

/** The column each filter compares against. */
const FILTER_COLUMN = {
  status: professors.status,
  rank: professors.academicRank,
  university: professors.university,
  faculty: professors.faculty,
  department: professors.department,
  specialization: professors.specialization,
} as const;

/**
 * How many records the register holds, ignoring the current query.
 *
 * The denominator in «۱۰ نفر از ۲۶» — a different question from the result's
 * own total, and a filter that caught 10 of 26 looks identical to one that
 * caught 10 of 4,000 without it.
 */
export async function registerSize(tenantId: string): Promise<number> {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(professors)
      .where(isNull(professors.deletedAt)),
  );
  return row?.total ?? 0;
}

export function professorConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(professors.deletedAt)];

  if (query.search.trim()) {
    /*
     * Against the stored column, not a six-column expression built per row.
     *
     * `professors.search_text` is generated from exactly those six columns and
     * carries a trigram index; folding them here instead meant the index could
     * never be used and every keystroke read the whole directory. The
     * expression is the same either way — what changed is where it is computed.
     *
     * The needle is folded by the same function that built the haystack. That
     * is not belt and braces: it is the only thing that makes the two
     * comparable, and a search typed on an Arabic keyboard would otherwise
     * never match a record filed from a Persian one.
     *
     * One `LIKE` per typed word, ANDed — «سعید نظ» must find «سعید نظیفی», and a
     * single needle containing a space cannot, because the folded column
     * separates its parts with that same space in a different order.
     */
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      conditions.push(sql`${professors.searchText} LIKE '%' || app.fold_text(${word}) || '%'`);
    }
  }

  for (const filter of FILTERS) {
    const chosen = query.filters[filter.key];
    if (!chosen) continue;

    /*
     * A vocabulary value is compared exactly, because it is a key. A free-text
     * one is compared *folded*, because the same specialisation is written
     * «داخلی دام‌های بزرگ» on some records and «داخلی دامهای بزرگ» on others —
     * the dropdown folds those into one entry, so an exact `=` would leave one
     * of the two spellings out of its own filter.
     */
    if (filter.set === null) {
      conditions.push(
        sql`app.fold_text(coalesce(${FILTER_COLUMN[filter.key]}, '')) = app.fold_text(${chosen})`,
      );
      continue;
    }
    conditions.push(eq(FILTER_COLUMN[filter.key], chosen));
  }

  return conditions;
}

export async function readProfessors(
  tenantId: string,
  query: RegisterQuery,
  options: { includeNationalId?: boolean } = {},
): Promise<RegisterPage<ProfessorRow>> {
  const nationalId = options.includeNationalId ? professors.nationalId : sql<string | null>`null`;
  const textOrder = (column: AnyPgColumn) => sql<string>`coalesce(${column}, '')`;
  const orders: Record<string, SQL[]> = {
    professorCode: [textOrder(professors.professorCode)],
    name: [textOrder(professors.lastName), textOrder(professors.firstName)],
    rank: [textOrder(professors.academicRank)],
    affiliation: [textOrder(professors.university), textOrder(professors.faculty)],
    department: [textOrder(professors.department)],
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
        professors.id,
        cursor.id,
        cursor.mode,
      )
    : undefined;
  const page = cursor ? cursor.page : query.cursor ? 1 : Math.max(1, query.page);
  const offset = cursor || query.cursor ? 0 : (page - 1) * query.size;
  const physicalOrder = directionalKeysetOrder(
    directionalOrder,
    professors.id,
    cursor?.mode ?? null,
  );

  const fetched = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: professors.id,
        professorCode: professors.professorCode,
        nationalId,
        firstName: professors.firstName,
        lastName: professors.lastName,
        academicRank: professors.academicRank,
        gender: professors.gender,
        isFacultyMember: professors.isFacultyMember,
        university: professors.university,
        faculty: professors.faculty,
        department: professors.department,
        email: professors.email,
        phone: professors.phone,
        version: professors.version,
        total: sql<number>`count(*) over()`.mapWith(Number),
        cursor0: order[0] ?? sql<string>`''`,
        cursor1: order[1] ?? sql<string>`''`,
        cursor2: order[2] ?? sql<string>`''`,
        cursor3: order[3] ?? sql<string>`''`,
        cursor4: order[4] ?? sql<string>`''`,
        cursor5: order[5] ?? sql<string>`''`,
      })
      .from(professors)
      .where(and(...professorConditions(query), ...(boundary ? [boundary] : [])))
      .orderBy(...physicalOrder)
      .limit(query.size + 1)
      .offset(offset),
  );

  if (fetched.length === 0 && page > 1 && !cursor) {
    return readProfessors(tenantId, { ...query, page: 1, cursor: "" }, options);
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
export async function specialisations(tenantId: string, limit = 200): Promise<string[]> {
  const column = professors.specialization;
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({ value: sql<string>`min(${column})` })
      .from(professors)
      .where(and(isNull(professors.deletedAt), sql`coalesce(${column}, '') <> ''`))
      .groupBy(sql`app.fold_text(${column})`)
      .orderBy(sql`min(${column})`)
      .limit(limit),
  );
  return rows.map((row) => row.value).filter(Boolean);
}

/** One professor, whole, for the record page and the form.
 *
 * `cache()`: read twice per view (metadata + page) — see the council queries. */
export const readProfessor = cache(async (tenantId: string, id: string) => {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(professors)
      .where(and(eq(professors.id, id), isNull(professors.deletedAt)))
      .limit(1),
  );
  return row ?? null;
});

/** One supervised student, with the chair this professor holds on their file. */
export interface SupervisedStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  degree: string | null;
  status: string | null;
  /** Which seat: the first, second or third supervisor, or the advisor. */
  seat: "primary" | "secondary" | "third" | "advisor";
  /** An approved council appointment links this assignment to a decision. */
  hasCouncilDecision: boolean;
}

/**
 * The students on this professor's file, in every seat they hold.
 *
 * ── Why the seat is part of the answer ──────────────────────────────────────
 *
 * «Nine students» is four different facts. A first supervisor carries the work;
 * a third is a name on a panel. The supervision regulation charges them
 * differently, and an office reading this record is usually asking «can this
 * person take another» — which the count alone cannot answer.
 *
 * One statement with the seat named by a `CASE`, not four queries unioned: a
 * professor may hold two seats on one student's file, and four queries would
 * report that student twice with no way to tell it from two students.
 */
export async function supervisedStudents(
  tenantId: string,
  professorId: string,
): Promise<SupervisedStudent[]> {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: students.id,
        studentNumber: students.studentNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        degree: students.degree,
        status: students.status,
        hasCouncilDecision: sql<boolean>`exists (
          select 1
          from ${councilDecisions} as d
          where d.student_id = ${students.id}
            and d.deleted_at is null
            and d.report_category in ('thesis_proposal', 'dissertation_proposal', 'thesis_final_defense', 'dissertation_final_defense')
            and d.review_status in ('approved', 'conditional')
        )`,
        seat: sql<SupervisedStudent["seat"]>`case
          when ${students.primarySupervisorId} = ${professorId} then 'primary'
          when ${students.secondarySupervisorId} = ${professorId} then 'secondary'
          when ${students.thirdSupervisorId} = ${professorId} then 'third'
          else 'advisor' end`,
      })
      .from(students)
      .where(
        and(
          isNull(students.deletedAt),
          or(
            eq(students.primarySupervisorId, professorId),
            eq(students.secondarySupervisorId, professorId),
            eq(students.thirdSupervisorId, professorId),
            eq(students.advisorId, professorId),
          ),
        ),
      )
      /* By family name, which is how a list of people is read. */
      .orderBy(asc(students.lastName), asc(students.firstName), asc(students.id)),
  );
}
