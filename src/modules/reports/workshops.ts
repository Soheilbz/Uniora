import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import { jalaliYear, type Tally } from "./shared.ts";

/* ── Workshops ────────────────────────────────────────────────────────────── */

export interface WorkshopReport {
  byYear: { year: number; count: number }[];
  byStatus: Tally[];
  rows: {
    id: string;
    title: string;
    date: string | null;
    registered: number;
    attended: number;
    certificates: number;
  }[];
  totals: { workshops: number; registered: number; attended: number; certificates: number };
  /**
   * What the workshops workflow lets through, counted.
   *
   * ── Why a screen has to say these ───────────────────────────────────────
   *
   * There is no state machine behind a workshop. Nothing stops one staying
   * «فعال» a year after it was held, or a certificate being issued to somebody
   * the attendance sheet does not show attending. Until something does, naming
   * these where an office reads them once a term is the control — and the
   * figures are what the case for changing the workflow is argued from.
   *
   * ── Two the reference counts and this does not ──────────────────────────
   *
   * The report also counts duplicate registrations and
   * colliding certificate numbers. Neither can happen here: the two partial
   * unique indexes on `workshop_participants` and the unique index on the
   * certificate number refuse them at the database. A figure that is always
   * zero is not reassurance — it is a line an office learns to skip, and it
   * would go on being skipped if the constraint were ever dropped.
   */
  gaps: {
    /** Attended, and still owed the sheet that is the point of attending. */
    certificatesOutstanding: number;
    /** Issued to somebody the record does not show attending. */
    certificatesUnearned: number;
    /** Issued against a workshop that was cancelled. */
    certificatesOnCancelled: number;
    /** More registrations than the workshop had places. */
    overSubscribed: number;
  };
}

export async function workshopReport(
  tenantId: string,
  year: number | null,
): Promise<WorkshopReport> {
  return readOnly(tenantId, async (tx) => {
    /*
     * The three counts are correlated subqueries and the outer table is named.
     *
     * Drizzle renders an embedded column unqualified, and a bare name inside a
     * subquery binds to the subquery's own table first — which is how the
     * council's business count silently returned zero on every row. Joining
     * instead would multiply: a workshop with six participants and four
     * certificates would report twenty-four of each.
     */
    const rows = await tx.execute(sql`
      select
        w.id, w.title, w.workshop_date as date, w.status,
        (select count(*) from workshop_participants p
          where p.workshop_id = w.id and p.deleted_at is null)::int as registered,
        (select count(*) from workshop_participants p
          where p.workshop_id = w.id and p.deleted_at is null
            and p.attendance_status = 'attended')::int as attended,
        (select count(*) from workshop_certificates c
          where c.workshop_id = w.id and c.deleted_at is null)::int as certificates
      from workshops w
      where w.deleted_at is null ${
        year === null ? sql.empty() : sql` and ${jalaliYear("w.workshop_date")} = ${year}`
      }
      order by w.workshop_date desc nulls last`);

    const listed = (
      rows.rows as {
        id: string;
        title: string;
        date: string | null;
        status: string | null;
        registered: number;
        attended: number;
        certificates: number;
      }[]
    ).map((row) => ({
      ...row,
      registered: Number(row.registered),
      attended: Number(row.attended),
      certificates: Number(row.certificates),
    }));

    const byYearRows = await tx.execute(sql`
      select ${jalaliYear("workshop_date")} as year, count(*)::int as count
      from workshops
      where deleted_at is null and workshop_date is not null
      group by 1
      order by 1`);

    /*
     * The four gaps, in one statement.
     *
     * Counted over the whole register rather than the chosen year: a
     * certificate owed since last spring does not stop being owed because the
     * reader is looking at this year, and an office chasing them wants the
     * whole list. The bands above answer the year's question.
     */
    const gapRows = await tx.execute(sql`
      select
        (select count(*) from workshop_participants p
           join workshops w on w.id = p.workshop_id and w.deleted_at is null
          where p.deleted_at is null
            and p.attendance_status = 'attended'
            and not exists (
              select 1 from workshop_certificates c
               where c.participant_id = p.id and c.deleted_at is null))
          ::int as certificates_outstanding,

        (select count(*) from workshop_certificates c
           join workshop_participants p on p.id = c.participant_id and p.deleted_at is null
          where c.deleted_at is null
            and p.attendance_status <> 'attended')
          ::int as certificates_unearned,

        (select count(*) from workshop_certificates c
           join workshops w on w.id = c.workshop_id and w.deleted_at is null
          where c.deleted_at is null
            and w.status = 'cancelled')
          ::int as certificates_on_cancelled,

        /* Only where a capacity was actually set: «۰» means «not recorded»
           on this column, and every workshop would otherwise report as
           over-subscribed the moment one person signed up. */
        (select count(*) from workshops w
          where w.deleted_at is null
            and w.capacity > 0
            and (select count(*) from workshop_participants p
                  where p.workshop_id = w.id and p.deleted_at is null) > w.capacity)
          ::int as over_subscribed`);

    const [gaps] = gapRows.rows as {
      certificates_outstanding: number;
      certificates_unearned: number;
      certificates_on_cancelled: number;
      over_subscribed: number;
    }[];

    const byStatus = new Map<string, number>();
    for (const row of listed) {
      const key = row.status ?? "";
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }

    return {
      byYear: (byYearRows.rows as { year: number; count: number }[]).map((row) => ({
        year: Number(row.year),
        count: Number(row.count),
      })),
      byStatus: [...byStatus].map(([value, count]) => ({ value, count })),
      rows: listed.map(({ status: _status, ...row }) => row),
      totals: {
        workshops: listed.length,
        registered: listed.reduce((sum, row) => sum + row.registered, 0),
        attended: listed.reduce((sum, row) => sum + row.attended, 0),
        certificates: listed.reduce((sum, row) => sum + row.certificates, 0),
      },
      gaps: {
        certificatesOutstanding: Number(gaps?.certificates_outstanding ?? 0),
        certificatesUnearned: Number(gaps?.certificates_unearned ?? 0),
        certificatesOnCancelled: Number(gaps?.certificates_on_cancelled ?? 0),
        overSubscribed: Number(gaps?.over_subscribed ?? 0),
      },
    };
  });
}
