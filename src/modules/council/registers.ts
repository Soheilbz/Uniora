import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { cache } from "react";
import { councilAppointments, councilDecisions, councilRulings, professors } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { directionalOrderFor } from "@/lib/register/sort-order.ts";
import type { RegisterPage, RegisterQuery } from "@/lib/register/spec.ts";
import type { AppointmentRow, RulingRow } from "./model.ts";

/**
 * The decisions screen's other two registers.
 *
 * Separate from `queries.ts` only because that file was already the sittings and
 * the dossiers; these are the two tabs beside them. Same shapes, same rules —
 * one statement each, the vocabulary's own order for a sorted vocabulary column,
 * and the primary key as a tiebreaker so a page boundary cannot repeat a row.
 */

/* ── Rulings ──────────────────────────────────────────────────────────────── */

export function rulingConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(councilRulings.deletedAt)];

  if (query.search.trim()) {
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      conditions.push(sql`
        app.fold_text(
          coalesce(${councilRulings.meetingNumber}, '') || ' ' ||
          coalesce(${councilRulings.decisionText}, '') || ' ' ||
          coalesce(${councilRulings.decisionDescription}, '')
        ) LIKE '%' || app.fold_text(${word}) || '%'`);
    }
  }

  if (query.filters.category) {
    conditions.push(eq(councilRulings.reportCategory, query.filters.category));
  }
  if (query.filters.status) conditions.push(eq(councilRulings.reviewStatus, query.filters.status));

  return conditions;
}

export async function readRulings(
  tenantId: string,
  query: RegisterQuery,
): Promise<RegisterPage<RulingRow>> {
  /*
   * The table is written out in these subqueries rather than interpolated.
   *
   * Drizzle renders an embedded column unqualified, and a bare name inside a
   * subquery resolves against the subquery's own table first — which is how the
   * sittings' business count silently returned zero for every row. See the
   * comment on that query.
   */
  const orders: Record<string, (SQL | AnyPgColumn)[]> = {
    meeting: [
      councilRulings.meetingDate,
      sql`nullif(substring(${councilRulings.meetingNumber} from '^[0-9]+'), '')::bigint`,
    ],
    category: [
      sql`(select l.position from lookups l
           where l.set = 'ruling_report_categories'
             and l.value = council_rulings.report_category limit 1)`,
    ],
    status: [
      sql`(select l.position from lookups l
           where l.set = 'council_review_statuses'
             and l.value = council_rulings.review_status limit 1)`,
    ],
  };
  const directionalOrder = directionalOrderFor(orders, query, "meeting");

  const page = Math.max(1, query.page);
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilRulings.id,
        version: councilRulings.version,
        meetingId: councilRulings.meetingId,
        meetingNumber: councilRulings.meetingNumber,
        meetingDate: councilRulings.meetingDate,
        reportCategory: councilRulings.reportCategory,
        reviewStatus: councilRulings.reviewStatus,
        decisionText: councilRulings.decisionText,
        decisionDescription: councilRulings.decisionDescription,
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(councilRulings)
      .where(and(...rulingConditions(query)))
      .orderBy(
        ...directionalOrder.map((entry) => (entry.direction === "desc" ? desc : asc)(entry.column)),
        asc(councilRulings.id),
      )
      .limit(query.size)
      .offset((page - 1) * query.size),
  );

  if (rows.length === 0 && page > 1) {
    return readRulings(tenantId, { ...query, page: 1 });
  }

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(({ total: _total, ...row }) => row),
    total,
    pages: Math.max(1, Math.ceil(total / query.size)),
    page,
  };
}

/* ── Appointments ─────────────────────────────────────────────────────────── */

export function appointmentConditions(query: RegisterQuery): SQL[] {
  const conditions: SQL[] = [isNull(councilAppointments.deletedAt)];

  if (query.search.trim()) {
    const words = query.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const word of words) {
      conditions.push(sql`
        app.fold_text(
          coalesce(${councilAppointments.meetingNumber}, '') || ' ' ||
          coalesce(${councilAppointments.studentNumber}, '') || ' ' ||
          coalesce(${councilAppointments.studentName}, '')
        ) LIKE '%' || app.fold_text(${word}) || '%'`);
    }
  }

  if (query.filters.level) {
    conditions.push(eq(councilAppointments.educationLevel, query.filters.level));
  }
  if (query.filters.field) {
    conditions.push(eq(councilAppointments.fieldOfStudy, query.filters.field));
  }

  return conditions;
}

export async function readAppointments(
  tenantId: string,
  query: RegisterQuery,
): Promise<RegisterPage<AppointmentRow>> {
  /*
   * The three chairs, resolved to names in the same statement.
   *
   * Three aliases of the professor directory, because the same table joined
   * three times is three different people. Reading the ids and stitching the
   * names in JavaScript would be four round trips per page, and a name that is
   * missing whenever the second query races the first.
   */
  const first = alias(professors, "seat_primary");
  const second = alias(professors, "seat_secondary");
  const third = alias(professors, "seat_third");

  /*
   * `alias<typeof professors, string>` rather than `typeof first`.
   *
   * Each alias carries its own name as a *literal* type, so a helper typed
   * against the first one refuses the other two — the compiler is right that
   * `"seat_secondary"` is not `"seat_primary"`. Widening the name to `string` is
   * what makes one helper serve all three.
   */
  const name = (table: ReturnType<typeof alias<typeof professors, string>>) =>
    sql<string>`nullif(btrim(coalesce(${table.firstName}, '') || ' ' || coalesce(${table.lastName}, '')), '')`;

  const orders: Record<string, (SQL | AnyPgColumn)[]> = {
    meeting: [
      councilAppointments.meetingDate,
      sql`nullif(substring(${councilAppointments.meetingNumber} from '^[0-9]+'), '')::bigint`,
    ],
    student: [councilAppointments.studentName, councilAppointments.studentNumber],
    placement: [
      sql`(select l.position from lookups l
           where l.set = 'degrees'
             and l.value = council_appointments.education_level limit 1)`,
    ],
  };
  const directionalOrder = directionalOrderFor(orders, query, "meeting");

  const page = Math.max(1, query.page);
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilAppointments.id,
        version: councilAppointments.version,
        meetingId: councilAppointments.meetingId,
        meetingNumber: councilAppointments.meetingNumber,
        meetingDate: councilAppointments.meetingDate,
        studentId: councilAppointments.studentId,
        studentNumber: councilAppointments.studentNumber,
        studentName: councilAppointments.studentName,
        educationLevel: councilAppointments.educationLevel,
        fieldOfStudy: councilAppointments.fieldOfStudy,
        primarySupervisor: name(first),
        secondarySupervisor: name(second),
        thirdSupervisor: name(third),
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(councilAppointments)
      .leftJoin(first, eq(first.id, councilAppointments.primarySupervisorId))
      .leftJoin(second, eq(second.id, councilAppointments.secondarySupervisorId))
      .leftJoin(third, eq(third.id, councilAppointments.thirdSupervisorId))
      .where(and(...appointmentConditions(query)))
      .orderBy(
        ...directionalOrder.map((entry) => (entry.direction === "desc" ? desc : asc)(entry.column)),
        asc(councilAppointments.id),
      )
      .limit(query.size)
      .offset((page - 1) * query.size),
  );

  if (rows.length === 0 && page > 1) {
    return readAppointments(tenantId, { ...query, page: 1 });
  }

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(({ total: _total, ...row }) => row),
    total,
    pages: Math.max(1, Math.ceil(total / query.size)),
    page,
  };
}

/* ── One record of each ───────────────────────────────────────────────────── */

/* `cache()`: read twice per view (metadata + page) — see the council queries. */
export const readRuling = cache(async (tenantId: string, id: string) => {
  const [record] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(councilRulings)
      .where(and(eq(councilRulings.id, id), isNull(councilRulings.deletedAt)))
      .limit(1),
  );
  return record ?? null;
});

export const readAppointment = cache(async (tenantId: string, id: string) => {
  const [record] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(councilAppointments)
      .where(and(eq(councilAppointments.id, id), isNull(councilAppointments.deletedAt)))
      .limit(1),
  );
  return record ?? null;
});

/**
 * How many rows each tab holds.
 *
 * On the tab strip itself, because a tab that says «احکام» tells nobody whether
 * it is worth opening, and three empty tabs beside a full one is a thing an
 * office needs to see without clicking twice. One transaction, so the three
 * counts are one consistent picture.
 */
export async function tabCounts(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    const [decisions] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(councilDecisions)
      .where(isNull(councilDecisions.deletedAt));
    const [rulings] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(councilRulings)
      .where(isNull(councilRulings.deletedAt));
    const [appointments] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(councilAppointments)
      .where(isNull(councilAppointments.deletedAt));

    return {
      decisions: decisions?.total ?? 0,
      rulings: rulings?.total ?? 0,
      appointments: appointments?.total ?? 0,
    };
  });
}
