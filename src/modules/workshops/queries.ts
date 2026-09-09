import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { cache } from "react";
import {
  institutions,
  professors,
  students,
  workshopCertificates,
  workshopInstructors,
  workshopParticipants,
  workshopRegistrations,
  workshops,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { decodeRegisterCursor, encodeRegisterCursor } from "@/lib/register/cursor.ts";
import { directionalKeysetBoundary, directionalKeysetOrder } from "@/lib/register/keyset.ts";
import { cursorValues, directionalOrderFor } from "@/lib/register/sort-order.ts";
import type { RegisterPage, RegisterQuery } from "@/lib/register/spec.ts";
import type { WorkshopRow } from "./model.ts";

/** Reading the workshop register and one workshop's three lists. */

export function workshopConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(workshops.deletedAt)];

  if (query.search.trim()) {
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      conditions.push(sql`${workshops.searchText} LIKE '%' || app.fold_text(${word}) || '%'`);
    }
  }

  if (query.filters.status) conditions.push(eq(workshops.status, query.filters.status));
  if (query.filters.location) conditions.push(eq(workshops.locationType, query.filters.location));

  return conditions;
}

export async function readWorkshops(
  tenantId: string,
  query: RegisterQuery,
): Promise<RegisterPage<WorkshopRow>> {
  /*
   * Three counts per workshop, each its own correlated subquery.
   *
   * The table name is written out on the outer reference rather than
   * interpolated — Drizzle renders an embedded column unqualified, and a bare
   * name inside a subquery binds to the subquery's own table first. That is
   * exactly how the council's business count silently returned zero on every
   * row, and it is invisible in TypeScript.
   *
   * Subqueries rather than joins because joining two one-to-many tables to one
   * row multiplies them: a workshop with six participants and four certificates
   * would report twenty-four of each.
   */
  const registered = sql<number>`(
    select count(*) from workshop_participants wp
    where wp.workshop_id = workshops.id and wp.deleted_at is null)`.mapWith(Number);

  const attended = sql<number>`(
    select count(*) from workshop_participants wp
    where wp.workshop_id = workshops.id and wp.deleted_at is null
      and wp.attendance_status = 'attended')`.mapWith(Number);

  const certificates = sql<number>`(
    select count(*) from workshop_certificates wc
    where wc.workshop_id = workshops.id and wc.deleted_at is null)`.mapWith(Number);

  const textOrder = (column: AnyPgColumn) => sql<string>`coalesce(${column}, '')`;
  const dateOrder = (column: AnyPgColumn) =>
    sql<string>`coalesce(${column}, date '0001-01-01')::text`;
  const numberOrder = (column: AnyPgColumn) => sql<number>`coalesce(${column}, 0)`.mapWith(Number);

  const orders: Record<string, SQL[]> = {
    title: [textOrder(workshops.title)],
    workshopDate: [dateOrder(workshops.workshopDate)],
    capacity: [numberOrder(workshops.capacity)],
  };
  const directionalOrder = directionalOrderFor(orders, query, "workshopDate");
  const order = directionalOrder.map((entry) => entry.column as SQL);
  const decoded = decodeRegisterCursor(query, query.cursor ?? "", directionalOrder.length);
  const cursor = decoded?.values.every((value) => value !== null)
    ? { ...decoded, values: decoded.values as (string | number)[] }
    : null;
  const boundary = cursor
    ? directionalKeysetBoundary(
        directionalOrder,
        cursor.values,
        workshops.id,
        cursor.id,
        cursor.mode,
      )
    : undefined;
  const page = cursor ? cursor.page : query.cursor ? 1 : Math.max(1, query.page);
  const offset = cursor || query.cursor ? 0 : (page - 1) * query.size;
  const physicalOrder = directionalKeysetOrder(
    directionalOrder,
    workshops.id,
    cursor?.mode ?? null,
  );

  const fetched = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshops.id,
        version: workshops.version,
        title: workshops.title,
        workshopDate: workshops.workshopDate,
        durationHours: workshops.durationHours,
        locationType: workshops.locationType,
        venue: workshops.venue,
        capacity: workshops.capacity,
        status: workshops.status,
        registered,
        attended,
        certificates,
        total: sql<number>`count(*) over()`.mapWith(Number),
        cursor0: order[0] ?? sql<string>`''`,
        cursor1: order[1] ?? sql<string>`''`,
        cursor2: order[2] ?? sql<string>`''`,
        cursor3: order[3] ?? sql<string>`''`,
        cursor4: order[4] ?? sql<string>`''`,
        cursor5: order[5] ?? sql<string>`''`,
      })
      .from(workshops)
      .where(and(...workshopConditions(query), ...(boundary ? [boundary] : [])))
      .orderBy(...physicalOrder)
      .limit(query.size + 1)
      .offset(offset),
  );

  if (fetched.length === 0 && page > 1 && !cursor) {
    return readWorkshops(tenantId, { ...query, page: 1, cursor: "" });
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

/* `cache()`: read twice per view (metadata + page) — see the council queries. */
export const readWorkshop = cache(async (tenantId: string, id: string) => {
  const [record] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(workshops)
      .where(and(eq(workshops.id, id), isNull(workshops.deletedAt)))
      .limit(1),
  );
  return record ?? null;
});

export async function workshopRegisterSize(tenantId: string): Promise<number> {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(workshops)
      .where(isNull(workshops.deletedAt)),
  );
  return row?.total ?? 0;
}

/**
 * One workshop's three lists, in a single transaction.
 *
 * A participant is a student *or* an outsider, so the name is resolved with a
 * `coalesce` over the student register — one query, and a participant whose
 * student record was later retired still shows the name they registered under
 * where there is one.
 */
export async function readWorkshopLists(tenantId: string, workshopId: string) {
  return readOnly(tenantId, async (tx) => {
    const participants = await tx
      .select({
        id: workshopParticipants.id,
        version: workshopParticipants.version,
        studentId: workshopParticipants.studentId,
        name: sql<string>`coalesce(
          nullif(btrim(coalesce(${students.firstName}, '') || ' ' || coalesce(${students.lastName}, '')), ''),
          ${workshopParticipants.externalName}
        )`,
        studentNumber: students.studentNumber,
        affiliation: workshopParticipants.externalAffiliation,
        registrationDate: workshopParticipants.registrationDate,
        attendanceStatus: workshopParticipants.attendanceStatus,
        paymentStatus: workshopParticipants.paymentStatus,
        certificateId: workshopCertificates.id,
        certificateNumber: workshopCertificates.certificateNumber,
      })
      .from(workshopParticipants)
      .leftJoin(students, eq(students.id, workshopParticipants.studentId))
      .leftJoin(
        workshopCertificates,
        and(
          eq(workshopCertificates.participantId, workshopParticipants.id),
          isNull(workshopCertificates.deletedAt),
        ),
      )
      .where(
        and(
          eq(workshopParticipants.workshopId, workshopId),
          isNull(workshopParticipants.deletedAt),
        ),
      )
      .orderBy(asc(workshopParticipants.createdAt), asc(workshopParticipants.id));

    const instructors = await tx
      .select({
        id: workshopInstructors.id,
        professorId: workshopInstructors.professorId,
        name: sql<string>`coalesce(
          nullif(btrim(coalesce(${professors.firstName}, '') || ' ' || coalesce(${professors.lastName}, '')), ''),
          ${workshopInstructors.externalName}
        )`,
        affiliation: workshopInstructors.externalAffiliation,
        role: workshopInstructors.role,
      })
      .from(workshopInstructors)
      .leftJoin(professors, eq(professors.id, workshopInstructors.professorId))
      .where(
        and(eq(workshopInstructors.workshopId, workshopId), isNull(workshopInstructors.deletedAt)),
      )
      .orderBy(asc(workshopInstructors.role), asc(workshopInstructors.id));

    return { participants, instructors };
  });
}

/** Intake queue for public/staff/integration registrations on one workshop. */
export async function readWorkshopRegistrations(tenantId: string, workshopId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshopRegistrations.id,
        version: workshopRegistrations.version,
        fullName: workshopRegistrations.fullName,
        email: workshopRegistrations.email,
        phone: workshopRegistrations.phone,
        externalReference: workshopRegistrations.externalReference,
        status: workshopRegistrations.status,
        source: workshopRegistrations.source,
        consentAt: workshopRegistrations.consentAt,
        approvedAt: workshopRegistrations.approvedAt,
        participantId: workshopRegistrations.participantId,
        createdAt: workshopRegistrations.createdAt,
      })
      .from(workshopRegistrations)
      .where(
        and(
          eq(workshopRegistrations.workshopId, workshopId),
          isNull(workshopRegistrations.deletedAt),
        ),
      )
      .orderBy(asc(workshopRegistrations.status), asc(workshopRegistrations.createdAt)),
  );
}

export async function readPrintableCertificate(tenantId: string, certificateId: string) {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshopCertificates.id,
        certificateNumber: workshopCertificates.certificateNumber,
        issueDate: workshopCertificates.issueDate,
        verificationCode: workshopCertificates.verificationCode,
        workshopTitle: workshops.title,
        workshopDate: workshops.workshopDate,
        durationHours: workshops.durationHours,
        participantName: sql<string>`coalesce(nullif(btrim(coalesce(${students.firstName}, '') || ' ' || coalesce(${students.lastName}, '')), ''), ${workshopParticipants.externalName})`,
        institutionName: institutions.name,
        institutionNameEn: institutions.nameEn,
        faculty: institutions.faculty,
      })
      .from(workshopCertificates)
      .innerJoin(workshops, eq(workshops.id, workshopCertificates.workshopId))
      .innerJoin(
        workshopParticipants,
        eq(workshopParticipants.id, workshopCertificates.participantId),
      )
      .leftJoin(students, eq(students.id, workshopParticipants.studentId))
      .leftJoin(institutions, eq(institutions.tenantId, workshopCertificates.tenantId))
      .where(
        and(eq(workshopCertificates.id, certificateId), isNull(workshopCertificates.deletedAt)),
      )
      .limit(1),
  );
  return row ?? null;
}
