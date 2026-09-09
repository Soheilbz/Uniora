import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import { inYear, jalaliYear, type Tally } from "./shared.ts";

/* ── Council sittings ─────────────────────────────────────────────────────── */

export interface MeetingReport {
  perYear: { year: number; count: number; items: number }[];
  perMonth: Tally[];
  byChair: Tally[];
  byLocation: Tally[];
  businessMix: Tally[];
  business: { number: string | null; date: string | null; items: number }[];
  peak: { number: string | null; date: string | null; items: number } | null;
  attention: { noAttendance: number; noDeputy: number; barren: number };
  totals: {
    sittings: number;
    items: number;
    averagePresent: number | null;
    attendanceRate: number | null;
  };
}

export async function meetingReport(tenantId: string, year: number | null): Promise<MeetingReport> {
  return readOnly(tenantId, async (tx) => {
    const scope = inYear("meeting_date", year);

    const perYear = await tx.execute(sql`
      select ${jalaliYear("m.meeting_date")} as year,
        count(*)::int as count,
        coalesce(sum(
          (select count(*) from council_decisions d
             where d.deleted_at is null and (d.meeting_id = m.id or d.meeting_number = m.meeting_number))
          + (select count(*) from council_rulings r
             where r.deleted_at is null and (r.meeting_id = m.id or r.meeting_number = m.meeting_number))
          + (select count(*) from council_appointments a
             where a.deleted_at is null and (a.meeting_id = m.id or a.meeting_number = m.meeting_number))
        ), 0)::int as items
      from council_meetings m
      where m.deleted_at is null and m.meeting_date is not null
      group by 1
      order by 1`);

    /*
     * Sittings by Jalali month.
     *
     * The month comes from the same exact Nowruz boundary as the year. The
     * database returns only a number; the screen owns the localized month name.
     */
    const perMonth = await tx.execute(sql`
      select app.jalali_month(meeting_date)::text as value,
        count(*)::int as count
      from council_meetings
      where deleted_at is null and meeting_date is not null ${scope}
      group by 1
      order by 1`);

    const byChair = await tx.execute(sql`
      select coalesce(nullif(btrim(research_deputy), ''), '') as value, count(*)::int as count
      from council_meetings
      where deleted_at is null ${scope}
      group by 1
      order by count(*) desc, 1`);

    const byLocation = await tx.execute(sql`
      select coalesce(nullif(btrim(meeting_location), ''), '') as value, count(*)::int as count
      from council_meetings
      where deleted_at is null ${scope}
      group by 1
      order by count(*) desc, 1`);

    const businessMix = await tx.execute(sql`
      select 'decisions' as value, count(*)::int as count
      from council_decisions d
      where d.deleted_at is null and exists (
        select 1 from council_meetings m
        where m.deleted_at is null and (d.meeting_id = m.id or d.meeting_number = m.meeting_number) ${inYear("m.meeting_date", year)}
      )
      union all
      select 'rulings' as value, count(*)::int as count
      from council_rulings r
      where r.deleted_at is null and exists (
        select 1 from council_meetings m
        where m.deleted_at is null and (r.meeting_id = m.id or r.meeting_number = m.meeting_number) ${inYear("m.meeting_date", year)}
      )
      union all
      select 'appointments' as value, count(*)::int as count
      from council_appointments a
      where a.deleted_at is null and exists (
        select 1 from council_meetings m
        where m.deleted_at is null and (a.meeting_id = m.id or a.meeting_number = m.meeting_number) ${inYear("m.meeting_date", year)}
      )`);

    /*
     * What each sitting actually transacted: its decisions, its rulings and its
     * appointments together.
     *
     * Three correlated subqueries rather than three joins, because joining two
     * one-to-many tables to one row multiplies them — a sitting with six
     * decisions and four rulings would report twenty-four of each.
     */
    const business = await tx.execute(sql`
      select
        m.meeting_number as number,
        m.meeting_date as date,
        ((select count(*) from council_decisions d
           where d.deleted_at is null and (d.meeting_id = m.id or d.meeting_number = m.meeting_number))
         + (select count(*) from council_rulings r
             where r.deleted_at is null and (r.meeting_id = m.id or r.meeting_number = m.meeting_number))
         + (select count(*) from council_appointments a
             where a.deleted_at is null and (a.meeting_id = m.id or a.meeting_number = m.meeting_number)))::int as items
      from council_meetings m
      where m.deleted_at is null ${
        year === null ? sql.empty() : sql`and ${jalaliYear("m.meeting_date")} = ${year}`
      }
      order by m.meeting_date desc nulls last`);

    /*
     * Attendance, counted off the minuted lists.
     *
     * `participants` and `absentees` are `jsonb` arrays of names — not the
     * comma-separated text they look like on screen. Counting them as text
     * would have been a `btrim(jsonb)` and PostgreSQL refuses it outright,
     * which is the good case; the bad one would have been a silently plausible
     * average.
     *
     * A sitting with nothing in either list is `no_attendance`: not a sitting
     * nobody came to, but a minute that does not record who was there — a
     * different fault, and the one worth surfacing.
     */
    const attendance = await tx.execute(sql`
      select
        count(*) filter (
          where coalesce(jsonb_array_length(participants), 0) = 0
            and coalesce(jsonb_array_length(absentees), 0) = 0
        )::int as no_attendance,
        count(*) filter (where coalesce(btrim(research_deputy), '') = '')::int as no_deputy,
        avg(nullif(coalesce(jsonb_array_length(participants), 0), 0))::float as average_present
      from council_meetings
      where deleted_at is null ${scope}`);

    const allBusiness = (
      business.rows as { number: string | null; date: string | null; items: number }[]
    ).map((row) => ({ ...row, items: Number(row.items) }));
    const listed = allBusiness.slice(0, 20);

    const peak = allBusiness.reduce<(typeof allBusiness)[number] | null>(
      (best, row) => (best === null || row.items > best.items ? row : best),
      null,
    );

    const seen = (attendance.rows[0] ?? {}) as Record<string, number | null>;

    return {
      perYear: (perYear.rows as { year: number; count: number; items: number }[]).map((row) => ({
        year: Number(row.year),
        count: Number(row.count),
        items: Number(row.items),
      })),
      perMonth: (perMonth.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      byChair: (byChair.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      byLocation: (byLocation.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      businessMix: (businessMix.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      business: listed.slice(0, 20),
      peak,
      attention: {
        noAttendance: Number(seen.no_attendance ?? 0),
        noDeputy: Number(seen.no_deputy ?? 0),
        barren: allBusiness.filter((row) => row.items === 0).length,
      },
      totals: {
        sittings: listed.length,
        items: allBusiness.reduce((sum, row) => sum + row.items, 0),
        averagePresent:
          seen.average_present === null || seen.average_present === undefined
            ? null
            : Math.round(Number(seen.average_present) * 10) / 10,
        attendanceRate:
          allBusiness.length === 0
            ? null
            : Math.round(
                ((allBusiness.length - Number(seen.no_attendance ?? 0)) / allBusiness.length) * 100,
              ),
      },
    };
  });
}
