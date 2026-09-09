import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  professors,
  students,
  workshopCertificates,
  workshopInstructors,
  workshopParticipants,
  workshops,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { directionalOrderFor } from "@/lib/register/sort-order.ts";
import type { RegisterPage, RegisterQuery } from "@/lib/register/spec.ts";
import type { CertificateRow, InstructorRow, ParticipantRow } from "./model.ts";

/**
 * The workshops screen's other three registers.
 *
 * ── The other axis ──────────────────────────────────────────────────────────
 *
 * A workshop's own record already lists the people on it. These read the same
 * three tables the other way round — every instructor, every attendee, every
 * certificate, across every workshop — because that is the axis nothing else in
 * the product answers: «has this guest ever taught for us», «who still has not
 * paid», «what went out last week». One workshop at a time cannot answer any of
 * them without opening forty records.
 *
 * ── A name is one of two things ─────────────────────────────────────────────
 *
 * Every row here is either somebody in a directory — a professor, a student —
 * or an outside guest whose name is the only record of them. So the name is
 * `coalesce(directory, external)` and the id comes along beside it, null for a
 * guest: that is what lets the register link the ones it can and print the rest
 * plainly, rather than rendering a dead link for half the list.
 *
 * ── One statement each ──────────────────────────────────────────────────────
 *
 * Search, filters, sort and page resolved in SQL, like every other register
 * here. «Read them all and narrow in JavaScript» is a design that works on the
 * seed and falls over on an archive of ten years of workshops.
 */

/** The searchable name of a seat, whichever kind of person holds it. */
function instructorName() {
  return sql<string>`coalesce(
    nullif(btrim(coalesce(${professors.firstName}, '') || ' ' || coalesce(${professors.lastName}, '')), ''),
    ${workshopInstructors.externalName},
    ''
  )`;
}

function participantName() {
  return sql<string>`coalesce(
    nullif(btrim(coalesce(${students.firstName}, '') || ' ' || coalesce(${students.lastName}, '')), ''),
    ${workshopParticipants.externalName},
    ''
  )`;
}

/**
 * One folded `LIKE` per typed word, ANDed.
 *
 * «سعید نظ» must find «سعید نظیفی», and a single needle containing a space
 * cannot do that when the haystack joins its parts in a different order. Folded
 * on both sides, so a name typed on an Arabic keyboard matches one filed from a
 * Persian one — the same rule the student and professor registers follow.
 */
function wordMatches(search: string, haystack: SQL): SQL[] {
  const words = search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return words.map(
    (word) => sql`app.fold_text(${haystack}) LIKE '%' || app.fold_text(${word}) || '%'`,
  );
}

/**
 * How many rows to return.
 *
 * `query.size` is one of the page sizes the pager offers, so it cannot express
 * «everything the export is allowed» — the export asks for its own cap instead
 * of casting a number into a union it is not in.
 */
const rowsToTake = (query: RegisterQuery, limit?: number) => limit ?? query.size;

/* ── Instructors ──────────────────────────────────────────────────────────── */

export function instructorConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(workshopInstructors.deletedAt), isNull(workshops.deletedAt)];

  if (query.search.trim()) {
    conditions.push(
      ...wordMatches(
        query.search,
        sql`${instructorName()} || ' ' || coalesce(${workshops.title}, '') || ' ' ||
            coalesce(${workshopInstructors.externalAffiliation}, '')`,
      ),
    );
  }

  return conditions;
}

export async function readInstructors(
  tenantId: string,
  query: RegisterQuery,
  limit?: number,
  options: { includeNationalId?: boolean } = {},
): Promise<RegisterPage<InstructorRow>> {
  const nationalId = options.includeNationalId
    ? sql<
        string | null
      >`coalesce(${professors.nationalId}, ${workshopInstructors.externalNationalId})`
    : sql<string | null>`null`;
  const orders: Record<string, (SQL | AnyPgColumn)[]> = {
    name: [instructorName()],
    /* Newest workshop first when sorting by workshop: a register of events is
       read from the present backwards, like the sittings. */
    workshop: [workshops.workshopDate, workshops.title],
    role: [workshopInstructors.role],
  };
  const directionalOrder = directionalOrderFor(orders, query, "workshop");

  const page = Math.max(1, query.page);
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshopInstructors.id,
        workshopId: workshops.id,
        workshopTitle: workshops.title,
        workshopDate: workshops.workshopDate,
        name: instructorName(),
        professorId: professors.id,
        nationalId,
        affiliation: sql<
          string | null
        >`coalesce(${professors.department}, ${workshopInstructors.externalAffiliation})`,
        role: workshopInstructors.role,
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(workshopInstructors)
      .innerJoin(workshops, eq(workshops.id, workshopInstructors.workshopId))
      /* A left join, because most instructors here are guests. An inner one
         would silently drop every outside teacher from their own register. */
      .leftJoin(
        professors,
        and(eq(professors.id, workshopInstructors.professorId), isNull(professors.deletedAt)),
      )
      .where(and(...instructorConditions(query)))
      .orderBy(
        ...directionalOrder.map((entry) => (entry.direction === "desc" ? desc : asc)(entry.column)),
        asc(workshopInstructors.id),
      )
      .limit(rowsToTake(query, limit))
      .offset(limit === undefined ? (page - 1) * query.size : 0),
  );

  if (limit === undefined && rows.length === 0 && page > 1) {
    return readInstructors(tenantId, { ...query, page: 1 }, limit, options);
  }

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(({ total: _total, ...row }) => row),
    total,
    pages: Math.max(1, Math.ceil(total / rowsToTake(query, limit))),
    page,
  };
}

/* ── Participants ─────────────────────────────────────────────────────────── */

export function participantConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(workshopParticipants.deletedAt), isNull(workshops.deletedAt)];

  if (query.search.trim()) {
    conditions.push(
      ...wordMatches(
        query.search,
        sql`${participantName()} || ' ' || coalesce(${workshops.title}, '') || ' ' ||
            coalesce(${students.studentNumber}, '') || ' ' ||
            coalesce(${workshopParticipants.externalAffiliation}, '')`,
      ),
    );
  }

  if (query.filters.attendance) {
    conditions.push(eq(workshopParticipants.attendanceStatus, query.filters.attendance));
  }
  if (query.filters.payment) {
    conditions.push(eq(workshopParticipants.paymentStatus, query.filters.payment));
  }

  return conditions;
}

export async function readParticipants(
  tenantId: string,
  query: RegisterQuery,
  limit?: number,
  options: { includeNationalId?: boolean } = {},
): Promise<RegisterPage<ParticipantRow>> {
  const nationalId = options.includeNationalId
    ? sql<
        string | null
      >`coalesce(${students.nationalId}, ${workshopParticipants.externalNationalId})`
    : sql<string | null>`null`;
  const orders: Record<string, (SQL | AnyPgColumn)[]> = {
    name: [participantName()],
    workshop: [workshops.workshopDate, workshops.title],
    registered: [workshopParticipants.registrationDate],
    attendance: [workshopParticipants.attendanceStatus],
    payment: [workshopParticipants.paymentStatus],
  };
  const directionalOrder = directionalOrderFor(orders, query, "workshop");

  const page = Math.max(1, query.page);
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshopParticipants.id,
        workshopId: workshops.id,
        workshopTitle: workshops.title,
        workshopDate: workshops.workshopDate,
        name: participantName(),
        studentId: students.id,
        studentNumber: students.studentNumber,
        nationalId,
        mobile: sql<
          string | null
        >`coalesce(nullif(${students.phone}, ''), ${workshopParticipants.externalMobile})`,
        affiliation: workshopParticipants.externalAffiliation,
        registrationDate: workshopParticipants.registrationDate,
        attendanceStatus: workshopParticipants.attendanceStatus,
        paymentStatus: workshopParticipants.paymentStatus,
        /*
         * Whether the certificate that is the point of attending exists.
         *
         * A correlated subquery rather than a join: a seat has at most one
         * certificate — the schema's unique index says so — but joining would
         * still multiply the row if that index were ever dropped, and this
         * register's counts would go wrong silently.
         */
        certificateNumber: sql<string | null>`(
          select c.certificate_number
          from workshop_certificates c
          where c.participant_id = ${workshopParticipants.id}
            and c.deleted_at is null
          limit 1
        )`,
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(workshopParticipants)
      .innerJoin(workshops, eq(workshops.id, workshopParticipants.workshopId))
      .leftJoin(
        students,
        and(eq(students.id, workshopParticipants.studentId), isNull(students.deletedAt)),
      )
      .where(and(...participantConditions(query)))
      .orderBy(
        ...directionalOrder.map((entry) => (entry.direction === "desc" ? desc : asc)(entry.column)),
        asc(workshopParticipants.id),
      )
      .limit(rowsToTake(query, limit))
      .offset(limit === undefined ? (page - 1) * query.size : 0),
  );

  if (limit === undefined && rows.length === 0 && page > 1) {
    return readParticipants(tenantId, { ...query, page: 1 }, limit, options);
  }

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(({ total: _total, ...row }) => row),
    total,
    pages: Math.max(1, Math.ceil(total / rowsToTake(query, limit))),
    page,
  };
}

/* ── Certificates ─────────────────────────────────────────────────────────── */

export function certificateConditions(query: RegisterQuery): SQL[] {
  /* An issued certificate is an official historical instrument. Retiring its
     workshop removes the workshop from the active register, but must not erase
     the certificate from this register; the workshop row remains soft-deleted
     precisely so its title/date can still be joined here. */
  const conditions: SQL[] = [isNull(workshopCertificates.deletedAt)];

  if (query.search.trim()) {
    conditions.push(
      ...wordMatches(
        query.search,
        sql`${participantName()} || ' ' || coalesce(${workshops.title}, '') || ' ' ||
            coalesce(${workshopCertificates.certificateNumber}, '') || ' ' ||
            coalesce(${workshopCertificates.verificationCode}, '')`,
      ),
    );
  }

  return conditions;
}

export async function readCertificates(
  tenantId: string,
  query: RegisterQuery,
  limit?: number,
): Promise<RegisterPage<CertificateRow>> {
  const orders: Record<string, (SQL | AnyPgColumn)[]> = {
    /*
     * The number is an office sequence, so it sorts as one. Compared as text it
     * puts «۱۰» before «۹», which on a register of certificates is the kind of
     * order that makes somebody think one is missing.
     */
    number: [
      sql`nullif(substring(${workshopCertificates.certificateNumber} from '[0-9]+$'), '')::bigint`,
      workshopCertificates.certificateNumber,
    ],
    issued: [workshopCertificates.issueDate],
    name: [participantName()],
    workshop: [workshops.workshopDate, workshops.title],
  };
  const directionalOrder = directionalOrderFor(orders, query, "issued");

  const page = Math.max(1, query.page);
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshopCertificates.id,
        workshopId: workshops.id,
        workshopTitle: workshops.title,
        workshopDate: workshops.workshopDate,
        workshopDeletedAt: workshops.deletedAt,
        participantId: workshopCertificates.participantId,
        name: participantName(),
        studentId: students.id,
        certificateNumber: workshopCertificates.certificateNumber,
        issueDate: workshopCertificates.issueDate,
        verificationCode: workshopCertificates.verificationCode,
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(workshopCertificates)
      .innerJoin(workshops, eq(workshops.id, workshopCertificates.workshopId))
      .innerJoin(
        workshopParticipants,
        eq(workshopParticipants.id, workshopCertificates.participantId),
      )
      .leftJoin(
        students,
        and(eq(students.id, workshopParticipants.studentId), isNull(students.deletedAt)),
      )
      .where(and(...certificateConditions(query)))
      .orderBy(
        ...directionalOrder.map((entry) => (entry.direction === "desc" ? desc : asc)(entry.column)),
        asc(workshopCertificates.id),
      )
      .limit(rowsToTake(query, limit))
      .offset(limit === undefined ? (page - 1) * query.size : 0),
  );

  if (limit === undefined && rows.length === 0 && page > 1) {
    return readCertificates(tenantId, { ...query, page: 1 }, limit);
  }

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(({ total: _total, workshopDeletedAt, ...row }) => ({
      ...row,
      workshopRetired: workshopDeletedAt !== null,
    })),
    total,
    pages: Math.max(1, Math.ceil(total / rowsToTake(query, limit))),
    page,
  };
}

/* ── The figures on the tabs ──────────────────────────────────────────────── */

/**
 * How many rows each tab holds, ignoring the current query.
 *
 * A tab labelled «گواهی‌ها» tells nobody whether it is worth opening. These are
 * the whole-register totals rather than the narrowed ones, because the strip
 * describes what is behind each tab, not what the tab the reader is *on* has
 * been filtered down to.
 */
export async function workshopTabCounts(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    const count = sql<number>`count(*)`.mapWith(Number);

    const [workshopTotal] = await tx
      .select({ total: count })
      .from(workshops)
      .where(isNull(workshops.deletedAt));
    const [instructorTotal] = await tx
      .select({ total: count })
      .from(workshopInstructors)
      .where(isNull(workshopInstructors.deletedAt));
    const [participantTotal] = await tx
      .select({ total: count })
      .from(workshopParticipants)
      .where(isNull(workshopParticipants.deletedAt));
    const [certificateTotal] = await tx
      .select({ total: count })
      .from(workshopCertificates)
      .where(isNull(workshopCertificates.deletedAt));

    return {
      workshops: workshopTotal?.total ?? 0,
      instructors: instructorTotal?.total ?? 0,
      participants: participantTotal?.total ?? 0,
      certificates: certificateTotal?.total ?? 0,
    };
  });
}
