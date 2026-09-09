import { and, asc, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { cache } from "react";
import {
  councilAppointments,
  councilDecisions,
  councilMeetings,
  councilRulings,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { decodeRegisterCursor, encodeRegisterCursor } from "@/lib/register/cursor.ts";
import { directionalKeysetBoundary, directionalKeysetOrder } from "@/lib/register/keyset.ts";
import { cursorValues, directionalOrderFor } from "@/lib/register/sort-order.ts";
import type { RegisterPage, RegisterQuery } from "@/lib/register/spec.ts";
import type { DecisionRow, MeetingRow } from "./model.ts";

/**
 * Reading the council's registers.
 *
 * Each is one statement: search, filters, sort, page and — for the sittings —
 * the count of business filed against each row, all resolved in the database.
 */

/* ── Sittings ─────────────────────────────────────────────────────────────── */

export function meetingConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(councilMeetings.deletedAt)];

  if (query.search.trim()) {
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      conditions.push(sql`${councilMeetings.searchText} LIKE '%' || app.fold_text(${word}) || '%'`);
    }
  }

  /*
   * The three the register narrows by. Two of them have no reference list —
   * the deputy who chaired and the room it met in are typed on the record — so
   * their options come from the column and they compare folded: «سالن شورای
   * دانشکده» and «سالن شوراي دانشکده» are one room to a person and two to an
   * `=`.
   */
  if (query.filters.day) conditions.push(eq(councilMeetings.meetingDay, query.filters.day));

  for (const [key, column] of [
    ["deputy", councilMeetings.researchDeputy],
    ["location", councilMeetings.meetingLocation],
  ] as const) {
    const chosen = query.filters[key];
    if (chosen) {
      conditions.push(sql`app.fold_text(coalesce(${column}, '')) = app.fold_text(${chosen})`);
    }
  }

  return conditions;
}

export async function readMeetings(
  tenantId: string,
  query: RegisterQuery,
): Promise<RegisterPage<MeetingRow>> {
  const conditions = meetingConditions(query);
  const business = sql<number>`(
    (select count(*) from council_decisions cd
      where cd.deleted_at is null
        and (cd.meeting_id = council_meetings.id or cd.meeting_number = council_meetings.meeting_number))
    + (select count(*) from council_rulings cr
      where cr.deleted_at is null
        and (cr.meeting_id = council_meetings.id or cr.meeting_number = council_meetings.meeting_number))
    + (select count(*) from council_appointments ca
      where ca.deleted_at is null
        and (ca.meeting_id = council_meetings.id or ca.meeting_number = council_meetings.meeting_number))
  )`.mapWith(Number);
  const textOrder = (column: AnyPgColumn) => sql<string>`coalesce(${column}::text, '')`;
  const numberOrder =
    sql<number>`coalesce(nullif(substring(${councilMeetings.meetingNumber} from '^[0-9]+'), '')::integer, 2147483647)`.mapWith(
      Number,
    );
  const orders: Record<string, SQL[]> = {
    meetingNumber: [numberOrder],
    meetingDate: [textOrder(councilMeetings.meetingDate)],
    time: [textOrder(councilMeetings.meetingTime), textOrder(councilMeetings.meetingDay)],
    location: [textOrder(councilMeetings.meetingLocation)],
    deputy: [textOrder(councilMeetings.researchDeputy)],
    notes: [textOrder(councilMeetings.notes)],
  };
  const directionalOrder = directionalOrderFor(orders, query, "meetingDate");
  const order = directionalOrder.map((entry) => entry.column as SQL);
  const decoded = decodeRegisterCursor(query, query.cursor ?? "", directionalOrder.length);
  const cursor = decoded?.values.every((value) => value !== null)
    ? { ...decoded, values: decoded.values as (string | number)[] }
    : null;
  const boundary = cursor
    ? directionalKeysetBoundary(
        directionalOrder,
        cursor.values,
        councilMeetings.id,
        cursor.id,
        cursor.mode,
      )
    : undefined;
  const page = cursor ? cursor.page : query.cursor ? 1 : Math.max(1, query.page);
  const offset = cursor || query.cursor ? 0 : (page - 1) * query.size;
  const physicalOrder = directionalKeysetOrder(
    directionalOrder,
    councilMeetings.id,
    cursor?.mode ?? null,
  );

  const fetched = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilMeetings.id,
        version: councilMeetings.version,
        meetingNumber: councilMeetings.meetingNumber,
        meetingDate: councilMeetings.meetingDate,
        meetingTime: councilMeetings.meetingTime,
        meetingDay: councilMeetings.meetingDay,
        meetingLocation: councilMeetings.meetingLocation,
        researchDeputy: councilMeetings.researchDeputy,
        presentCount:
          sql<number>`coalesce(jsonb_array_length(${councilMeetings.participants}), 0)`.mapWith(
            Number,
          ),
        absentCount: sql<number>`(
          select count(*) from jsonb_array_elements_text(coalesce(${councilMeetings.absentees}, '[]'::jsonb)) as absent(name)
          where not (
            jsonb_exists(coalesce(${councilMeetings.substitutions}, '{}'::jsonb), absent.name)
            and jsonb_exists(coalesce(${councilMeetings.participants}, '[]'::jsonb), coalesce(${councilMeetings.substitutions} ->> absent.name, ''))
          )
        )`.mapWith(Number),
        participants: councilMeetings.participants,
        absentees: councilMeetings.absentees,
        substitutions: councilMeetings.substitutions,
        notes: councilMeetings.notes,
        businessCount: business,
        total: sql<number>`count(*) over()`.mapWith(Number),
        cursor0: order[0] ?? sql<string>`''`,
        cursor1: order[1] ?? sql<string>`''`,
        cursor2: order[2] ?? sql<string>`''`,
        cursor3: order[3] ?? sql<string>`''`,
        cursor4: order[4] ?? sql<string>`''`,
        cursor5: order[5] ?? sql<string>`''`,
      })
      .from(councilMeetings)
      .where(and(...conditions, ...(boundary ? [boundary] : [])))
      .orderBy(...physicalOrder)
      .limit(query.size + 1)
      .offset(offset),
  );

  if (fetched.length === 0 && page > 1 && !cursor) {
    return readMeetings(tenantId, { ...query, page: 1, cursor: "" });
  }
  const physicalPage = fetched.slice(0, query.size);
  const displayPage = cursor?.mode === "before" ? [...physicalPage].reverse() : physicalPage;
  const total = cursor?.total ?? fetched[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / query.size));
  const valuesFor = (row: (typeof displayPage)[number]) =>
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
    rows: displayPage.map(
      ({
        total: _total,
        cursor0: _cursor0,
        cursor1: _cursor1,
        cursor2: _cursor2,
        cursor3: _cursor3,
        cursor4: _cursor4,
        cursor5: _cursor5,
        ...row
      }) => row,
    ),
    total,
    pages,
    page,
    nextCursor,
    previousCursor,
    cursorMode: Boolean(cursor || nextCursor || previousCursor),
  };
}

/* ── Decisions ────────────────────────────────────────────────────────────── */

/**
 * What narrows the decisions register — search and filters, without the paging.
 *
 * Exported so the export route uses the *same* predicates as the screen. Two
 * copies drift, and the direction they drift is that a clerk filters to eleven
 * records and the file contains four thousand.
 */
export function decisionConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(councilDecisions.deletedAt)];

  if (query.search.trim()) {
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      /* Against the generated, trigram-indexed haystack — see the schema note
         on `search_text`. Building the folded expression per row would be
         a sequential scan of the archive on every keystroke. */
      conditions.push(
        sql`${councilDecisions.searchText} LIKE '%' || app.fold_text(${word}) || '%'`,
      );
    }
  }

  const filters = query.filters;
  if (filters.category) conditions.push(eq(councilDecisions.reportCategory, filters.category));
  if (filters.status) conditions.push(eq(councilDecisions.reviewStatus, filters.status));
  if (filters.level) conditions.push(eq(councilDecisions.educationLevel, filters.level));
  if (filters.field) conditions.push(eq(councilDecisions.fieldOfStudy, filters.field));
  if (filters.research) conditions.push(eq(councilDecisions.researchType, filters.research));

  return conditions;
}

/**
 * Ordering by a vocabulary's own order rather than by the stored key.
 *
 * `council_decisions` is written out for the same reason the business count
 * writes it out: `${column}` renders unqualified, and a bare column name inside
 * a subquery is resolved against the subquery's own table first. It happens to
 * work here — `lookups` has no `report_category` — but "happens to work because
 * the names do not collide" is not a property to rely on, and the day somebody
 * adds a column to `lookups` that shares a name with one of these, the sort
 * would silently start ordering by the wrong thing.
 */
function byVocabulary(column: AnyPgColumn, set: string) {
  return sql`(select l.position from lookups l
              where l.set = ${set} and l.value = council_decisions.${sql.raw(column.name)}
              limit 1)`;
}

export async function readDecisions(
  tenantId: string,
  query: RegisterQuery,
): Promise<RegisterPage<DecisionRow>> {
  const conditions = decisionConditions(query);
  const textOrder = (column: AnyPgColumn) => sql<string>`coalesce(${column}::text, '')`;
  const vocabOrder = (column: AnyPgColumn, set: string) =>
    sql<number>`coalesce((${byVocabulary(column, set)}), 2147483647)`.mapWith(Number);
  const meetingNumber =
    sql<number>`coalesce(nullif(substring(${councilDecisions.meetingNumber} from '^[0-9]+'), '')::integer, 2147483647)`.mapWith(
      Number,
    );
  const orders: Record<string, SQL[]> = {
    meeting: [textOrder(councilDecisions.meetingDate), meetingNumber],
    student: [textOrder(councilDecisions.studentName), textOrder(councilDecisions.studentNumber)],
    category: [vocabOrder(councilDecisions.reportCategory, "decision_report_categories")],
    status: [vocabOrder(councilDecisions.reviewStatus, "council_review_statuses")],
    placement: [
      vocabOrder(councilDecisions.educationLevel, "degrees"),
      vocabOrder(councilDecisions.fieldOfStudy, "fields_of_study"),
    ],
  };
  const directionalOrder = directionalOrderFor(orders, query, "meeting");
  const order = directionalOrder.map((entry) => entry.column as SQL);
  const decoded = decodeRegisterCursor(query, query.cursor ?? "", directionalOrder.length);
  const cursor = decoded?.values.every((value) => value !== null)
    ? { ...decoded, values: decoded.values as (string | number)[] }
    : null;
  const boundary = cursor
    ? directionalKeysetBoundary(
        directionalOrder,
        cursor.values,
        councilDecisions.id,
        cursor.id,
        cursor.mode,
      )
    : undefined;
  const page = cursor ? cursor.page : query.cursor ? 1 : Math.max(1, query.page);
  const offset = cursor || query.cursor ? 0 : (page - 1) * query.size;
  const physicalOrder = directionalKeysetOrder(
    directionalOrder,
    councilDecisions.id,
    cursor?.mode ?? null,
  );

  const fetched = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilDecisions.id,
        version: councilDecisions.version,
        meetingDate: councilDecisions.meetingDate,
        meetingId: councilDecisions.meetingId,
        meetingNumber: councilDecisions.meetingNumber,
        studentId: councilDecisions.studentId,
        studentNumber: councilDecisions.studentNumber,
        studentName: councilDecisions.studentName,
        educationLevel: councilDecisions.educationLevel,
        fieldOfStudy: councilDecisions.fieldOfStudy,
        thesisTitle: councilDecisions.thesisTitle,
        reportCategory: councilDecisions.reportCategory,
        reviewStatus: councilDecisions.reviewStatus,
        primarySupervisor: councilDecisions.primarySupervisor,
        secondarySupervisor: councilDecisions.secondarySupervisor,
        thirdSupervisor: councilDecisions.thirdSupervisor,
        firstAdvisor: councilDecisions.firstAdvisor,
        secondAdvisor: councilDecisions.secondAdvisor,
        thirdAdvisor: councilDecisions.thirdAdvisor,
        reviewer1: councilDecisions.reviewer1,
        reviewer2: councilDecisions.reviewer2,
        reviewer3: councilDecisions.reviewer3,
        reviewer4Invited: councilDecisions.reviewer4Invited,
        graduateStudiesRepresentative: councilDecisions.graduateStudiesRepresentative,
        total: sql<number>`count(*) over()`.mapWith(Number),
        cursor0: order[0] ?? sql<string>`''`,
        cursor1: order[1] ?? sql<string>`''`,
        cursor2: order[2] ?? sql<string>`''`,
        cursor3: order[3] ?? sql<string>`''`,
        cursor4: order[4] ?? sql<string>`''`,
        cursor5: order[5] ?? sql<string>`''`,
      })
      .from(councilDecisions)
      .where(and(...conditions, ...(boundary ? [boundary] : [])))
      .orderBy(...physicalOrder)
      .limit(query.size + 1)
      .offset(offset),
  );

  if (fetched.length === 0 && page > 1 && !cursor) {
    return readDecisions(tenantId, { ...query, page: 1, cursor: "" });
  }
  const physicalPage = fetched.slice(0, query.size);
  const displayPage = cursor?.mode === "before" ? [...physicalPage].reverse() : physicalPage;
  const total = cursor?.total ?? fetched[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / query.size));
  const valuesFor = (row: (typeof displayPage)[number]) =>
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
    rows: displayPage.map(
      ({
        total: _total,
        cursor0: _cursor0,
        cursor1: _cursor1,
        cursor2: _cursor2,
        cursor3: _cursor3,
        cursor4: _cursor4,
        cursor5: _cursor5,
        ...row
      }) => row,
    ),
    total,
    pages,
    page,
    nextCursor,
    previousCursor,
    cursorMode: Boolean(cursor || nextCursor || previousCursor),
  };
}

/* ── One sitting's own page ───────────────────────────────────────────────── */

/**
 * The distinct values a free-text sitting filter offers, folded into one entry.
 *
 * The deputy who chaired and the room it met in are typed on the record rather
 * than chosen from a list, so the options are whatever the register actually
 * holds — and folded, so one room spelled two ways is one choice. The stored
 * spelling of the first row in each group is what the option carries, since that
 * is a value somebody actually typed rather than a normalised form nothing in
 * the table matches.
 */
export async function meetingFilterValues(
  tenantId: string,
): Promise<{ deputy: string[]; location: string[] }> {
  const read = (column: AnyPgColumn) =>
    readOnly(tenantId, (tx) =>
      tx
        .select({ value: sql<string>`min(${column})` })
        .from(councilMeetings)
        .where(and(isNull(councilMeetings.deletedAt), sql`coalesce(${column}, '') <> ''`))
        .groupBy(sql`app.fold_text(${column})`)
        .orderBy(sql`min(${column})`)
        .limit(200),
    );

  const [deputy, location] = await Promise.all([
    read(councilMeetings.researchDeputy),
    read(councilMeetings.meetingLocation),
  ]);
  return {
    deputy: deputy.map((row) => row.value).filter(Boolean),
    location: location.map((row) => row.value).filter(Boolean),
  };
}

/*
 * `cache()` because each record is read *twice* per view — once in
 * `generateMetadata` for the tab title, once by the page itself. React's
 * request cache makes the second call reuse the first within the same render,
 * so the main query runs once, not twice. The viewer and lookups were already
 * cached this way; these are the queries worth caching.
 */
export const readMeeting = cache(async (tenantId: string, id: string) => {
  const [record] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(councilMeetings)
      .where(and(eq(councilMeetings.id, id), isNull(councilMeetings.deletedAt)))
      .limit(1),
  );
  return record ?? null;
});

export const readDecision = cache(async (tenantId: string, id: string) => {
  const [record] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(councilDecisions)
      .where(and(eq(councilDecisions.id, id), isNull(councilDecisions.deletedAt)))
      .limit(1),
  );
  return record ?? null;
});

/**
 * Everything filed against one sitting, for its record page's three tabs.
 *
 * One transaction, so the three lists are a single consistent picture of the
 * sitting rather than three reads that can straddle a write.
 */
export async function readMeetingBusiness(tenantId: string, meetingId: string) {
  return readOnly(tenantId, async (tx) => {
    /*
     * ── Filed against this sitting, however it was filed ─────────────────────
     *
     * A decision routinely exists before its sitting record does — the schema
     * says so — and those rows carry `meeting_number` with a null `meeting_id`.
     * The register's business column counts them, so these lists must include
     * them: otherwise the register badges a sitting «۶ مورد» and its record
     * page shows four, which is two answers to one question and an office that
     * finds them different stops trusting both. `queries.integration.test.ts`
     * asserts they agree, and it is what caught this.
     */
    const [meeting] = await tx
      .select({ number: councilMeetings.meetingNumber, date: councilMeetings.meetingDate })
      .from(councilMeetings)
      .where(and(eq(councilMeetings.id, meetingId), isNull(councilMeetings.deletedAt)))
      .limit(1);

    const filedHere = (linked: AnyPgColumn, numbered: AnyPgColumn) =>
      meeting ? or(eq(linked, meetingId), eq(numbered, meeting.number)) : eq(linked, meetingId);

    /*
     * Each item's own recorded date, so the record page can say when one of
     * them disagrees with the sitting's.
     *
     * They can disagree honestly: a decision filed by number before the sitting
     * record existed carries whatever date the typist had, and the sitting was
     * later minuted for another day. Nothing here corrects it — the page says
     * how many, and somebody who knows which is right opens them.
     */
    const decisions = await tx
      .select({
        id: councilDecisions.id,
        meetingDate: councilDecisions.meetingDate,
        studentNumber: councilDecisions.studentNumber,
        studentName: councilDecisions.studentName,
        thesisTitle: councilDecisions.thesisTitle,
        reportCategory: councilDecisions.reportCategory,
        reviewStatus: councilDecisions.reviewStatus,
      })
      .from(councilDecisions)
      .where(
        and(
          filedHere(councilDecisions.meetingId, councilDecisions.meetingNumber),
          isNull(councilDecisions.deletedAt),
        ),
      )
      .orderBy(asc(councilDecisions.studentName), asc(councilDecisions.id));

    const rulings = await tx
      .select({
        id: councilRulings.id,
        meetingDate: councilRulings.meetingDate,
        reportCategory: councilRulings.reportCategory,
        reviewStatus: councilRulings.reviewStatus,
        decisionText: councilRulings.decisionText,
      })
      .from(councilRulings)
      .where(
        and(
          filedHere(councilRulings.meetingId, councilRulings.meetingNumber),
          isNull(councilRulings.deletedAt),
        ),
      )
      .orderBy(asc(councilRulings.createdAt), asc(councilRulings.id));

    const appointments = await tx
      .select({
        id: councilAppointments.id,
        meetingDate: councilAppointments.meetingDate,
        studentNumber: councilAppointments.studentNumber,
        studentName: councilAppointments.studentName,
        educationLevel: councilAppointments.educationLevel,
        fieldOfStudy: councilAppointments.fieldOfStudy,
        primarySupervisorId: councilAppointments.primarySupervisorId,
        secondarySupervisorId: councilAppointments.secondarySupervisorId,
        thirdSupervisorId: councilAppointments.thirdSupervisorId,
      })
      .from(councilAppointments)
      .where(
        and(
          filedHere(councilAppointments.meetingId, councilAppointments.meetingNumber),
          isNull(councilAppointments.deletedAt),
        ),
      )
      .orderBy(asc(councilAppointments.studentName), asc(councilAppointments.id));

    return { decisions, rulings, appointments, meetingDate: meeting?.date ?? null };
  });
}

/** Every sitting on file, for the "which sitting" box on a decision form. */
export async function readMeetingOptions(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilMeetings.id,
        meetingNumber: councilMeetings.meetingNumber,
        meetingDate: councilMeetings.meetingDate,
      })
      .from(councilMeetings)
      .where(isNull(councilMeetings.deletedAt))
      .orderBy(desc(councilMeetings.meetingDate))
      .limit(500),
  );
}

export async function councilRegisterSize(tenantId: string, table: "meetings" | "decisions") {
  const [row] = await readOnly(tenantId, (tx) =>
    table === "meetings"
      ? tx
          .select({ total: sql<number>`count(*)`.mapWith(Number) })
          .from(councilMeetings)
          .where(isNull(councilMeetings.deletedAt))
      : tx
          .select({ total: sql<number>`count(*)`.mapWith(Number) })
          .from(councilDecisions)
          .where(isNull(councilDecisions.deletedAt)),
  );
  return row?.total ?? 0;
}
