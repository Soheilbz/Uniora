import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import {
  PROPOSAL_DECISION_CATEGORIES,
  sqlInList,
  VALID_DECISION_STATUSES,
} from "@/lib/council-stage-policy.ts";
import type { Tally } from "./shared.ts";

/* ── Professors ───────────────────────────────────────────────────────────── */

export interface ProfessorReport {
  /** How many professors carry none, 1–2, 3–5, 6 or more students. */
  spread: Tally[];
  byStatus: Tally[];
  byRank: Tally[];
  byFaculty: Tally[];
  byDepartment: Tally[];
  byUniversity: Tally[];
  capacityDistribution: Tally[];
  /** The heaviest supervision loads, with the quota each is measured against. */
  heaviest: { name: string; rank: string | null; students: number; quota: number | null }[];
  /** Who the council appoints to examine, most first. */
  busiest: { name: string; rank: string | null; reviews: number }[];
  /** What share of all examining the ten busiest carry. */
  concentration: number | null;
  attention: {
    noQuota: number;
    noDepartment: number;
    noSpecialisation: number;
    idle: number;
    unresolved: number;
  };
  totals: { professors: number; supervising: number; examiners: number; reviews: number };
}

export async function professorReport(tenantId: string): Promise<ProfessorReport> {
  return readOnly(tenantId, async (tx) => {
    /* Five directory breakdowns, one scan and one round-trip. */
    const tallyRows = await tx.execute(sql`
      select metric, coalesce(nullif(btrim(value), ''), '') as value, count(*)::int as count
      from professors p
      cross join lateral (values
        ('status', p.status),
        ('faculty', p.faculty),
        ('department', p.department),
        ('university', p.university),
        ('rank', p.academic_rank)
      ) as breakdown(metric, value)
      where p.deleted_at is null
      group by metric, value
      order by metric, count(*) desc, value`);
    const talliesByMetric = tallyRows.rows as { metric: string; value: string; count: number }[];
    const tally = (metric: string): Tally[] =>
      talliesByMetric
        .filter((row) => row.metric === metric)
        .map((row) => ({ value: row.value, count: Number(row.count) }));

    /*
     * The supervision load, from the three supervisor columns unpivoted.
     *
     * A student names up to three supervisors and each of them carries that
     * student. Counting `primary_supervisor_id` alone would report a second
     * supervisor as idle; joining the three columns separately would need three
     * passes. The `values` list turns one student into up to three seats, which
     * is what the capacity engine does for the same reason.
     */
    const loads = await tx.execute(sql`
      with seats as (
        select seat.professor_id
        from students s
        cross join lateral (values
          (s.primary_supervisor_id), (s.secondary_supervisor_id), (s.third_supervisor_id)
        ) as seat(professor_id)
        where s.deleted_at is null and s.status = 'enrolled' and seat.professor_id is not null
      )
      select
        p.id,
        btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) as name,
        l.label as rank,
        count(seats.professor_id)::int as students,
        /*
         * The concurrent allowance, from the most recent year set for them.
         *
         * The «_total» columns, not the campus or external ones: those three
         * are a breakdown of the same allowance — «کل», «پردیس», «خارج» — and
         * summing them would report a quota three times its real size. The
         * masters and doctorate totals are added because a supervision load is
         * counted here as one figure across both.
         */
        (select q.masters_concurrent_total + q.doctorate_concurrent_total
           from professor_capacities q
          where q.professor_id = p.id and q.deleted_at is null
          order by q.year desc
          limit 1) as quota
      from professors p
      left join seats on seats.professor_id = p.id
      left join lookups l on l.set = 'academic_ranks' and l.value = p.academic_rank
      where p.deleted_at is null
      group by p.id, p.first_name, p.last_name, l.label
      order by count(seats.professor_id) desc, name`);

    const carried = (
      loads.rows as {
        id: string;
        name: string;
        rank: string | null;
        students: number;
        quota: number | null;
      }[]
    ).map((row) => ({
      ...row,
      students: Number(row.students),
      quota: row.quota === null ? null : Number(row.quota),
    }));

    /* The buckets the reference reports the spread in. */
    const bucket = (students: number) =>
      students === 0 ? "none" : students <= 2 ? "few" : students <= 5 ? "some" : "many";
    const spreadCounts = new Map<string, number>([
      ["none", 0],
      ["few", 0],
      ["some", 0],
      ["many", 0],
    ]);
    for (const row of carried) {
      const key = bucket(row.students);
      spreadCounts.set(key, (spreadCounts.get(key) ?? 0) + 1);
    }

    const byStatus = tally("status");
    const byFaculty = tally("faculty");
    const byDepartment = tally("department");
    const byUniversity = tally("university");
    const byRank = tally("rank");

    /*
     * The examining tally, folded on the name.
     *
     * The council minutes a board in free text — «دکتر محمدی» — so the identity
     * this is grouped by is the folded person-name, the same function the
     * reviewer-counts screen matches on. A tally grouped on the raw string would
     * report one examiner three times for three spellings.
     */
    const examiners = await tx.execute(sql`
      with appointed as (
        select
          app.name as raw,
          app.student_key || '|' || app.meeting || '|' || app.category as case_key
        from (
          select
            btrim(seat.name) as name,
            coalesce(nullif(d.student_number, ''), d.id::text) as student_key,
            coalesce(d.meeting_number::text, '') as meeting,
            coalesce(d.report_category, '') as category
          from council_decisions d
          cross join lateral (values
            (d.reviewer1), (d.reviewer2), (d.reviewer3), (d.reviewer4_invited)
          ) as seat(name)
          where d.deleted_at is null
            and d.report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
            and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            and btrim(coalesce(seat.name, '')) <> ''
        ) app
      )
      select
        app.fold_person(raw) as key,
        min(raw) as name,
        count(distinct case_key)::int as reviews
      from appointed
      where app.fold_person(raw) <> ''
      group by 1
      order by count(distinct case_key) desc, 2`);

    const tallies = (examiners.rows as { key: string; name: string; reviews: number }[]).map(
      (row) => ({ ...row, reviews: Number(row.reviews) }),
    );

    /* How many of those names the directory recognises — the rest are guests
       from other universities, or spellings nobody has reconciled. */
    const matched = await tx.execute(sql`
      select count(distinct app.fold_person(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')))::int as total
      from professors p
      where p.deleted_at is null
        and app.fold_person(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
            in (select app.fold_person(btrim(seat.name))
                  from council_decisions d
                  cross join lateral (values
                    (d.reviewer1), (d.reviewer2), (d.reviewer3), (d.reviewer4_invited)
                  ) as seat(name)
                 where d.deleted_at is null
                   and d.report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
                   and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
                   and btrim(coalesce(seat.name, '')) <> '')`);

    const gaps = await tx.execute(sql`
      select
        count(*) filter (
          where not exists (select 1 from professor_capacities q where q.professor_id = p.id)
        )::int as no_quota,
        count(*) filter (where coalesce(p.department, '') = '')::int as no_department,
        /* A specialisation is what matches an examiner to a thesis. Without one
           the office is picking a panel by department alone. */
        count(*) filter (where coalesce(p.specialization, '') = '')::int as no_specialisation
      from professors p
      where p.deleted_at is null`);

    const gap = (gaps.rows[0] ?? {}) as Record<string, number | string>;
    const totalReviews = tallies.reduce((sum, row) => sum + row.reviews, 0);
    const topTen = tallies.slice(0, 10).reduce((sum, row) => sum + row.reviews, 0);

    const capacityCounts = new Map<string, number>([
      ["noQuota", 0],
      ["within", 0],
      ["nearLimit", 0],
      ["exceeded", 0],
    ]);
    for (const row of carried) {
      const key =
        row.quota === null
          ? "noQuota"
          : row.students > row.quota
            ? "exceeded"
            : row.quota > 0 && row.students / row.quota >= 0.8
              ? "nearLimit"
              : "within";
      capacityCounts.set(key, (capacityCounts.get(key) ?? 0) + 1);
    }

    return {
      spread: [...spreadCounts].map(([value, count]) => ({ value, count })),
      byStatus,
      byRank,
      byFaculty,
      byDepartment,
      byUniversity,
      capacityDistribution: [...capacityCounts].map(([value, count]) => ({ value, count })),
      heaviest: carried
        .filter((row) => row.students > 0)
        .slice(0, 10)
        .map(({ id: _id, ...row }) => row),
      busiest: tallies.slice(0, 10).map((row) => ({
        name: row.name,
        rank: null,
        reviews: row.reviews,
      })),
      /* Null rather than 0 when nothing has been examined: «۰٪ تمرکز» would
         read as a perfectly even spread rather than as no data. */
      concentration: totalReviews === 0 ? null : Math.round((topTen / totalReviews) * 100),
      attention: {
        noQuota: Number(gap.no_quota ?? 0),
        noDepartment: Number(gap.no_department ?? 0),
        noSpecialisation: Number(gap.no_specialisation ?? 0),
        idle: carried.filter((row) => row.students === 0).length,
        unresolved:
          tallies.length - Number((matched.rows[0] as { total: number } | undefined)?.total ?? 0),
      },
      totals: {
        professors: carried.length,
        supervising: carried.filter((row) => row.students > 0).length,
        examiners: tallies.length,
        reviews: totalReviews,
      },
    };
  });
}
