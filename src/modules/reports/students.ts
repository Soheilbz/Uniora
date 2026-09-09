import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import {
  FINAL_DEFENSE_DECISION_CATEGORIES,
  PROPOSAL_DECISION_CATEGORIES,
  STUDENT_DECISION_CATEGORIES,
  sqlInList,
  VALID_DECISION_STATUSES,
} from "@/lib/council-stage-policy.ts";
import { jalaliYear, type Tally } from "./shared.ts";

/* ── Students ─────────────────────────────────────────────────────────────── */

export interface StudentReport {
  byStatus: Tally[];
  byDegree: Tally[];
  byField: Tally[];
  byFaculty: Tally[];
  byGender: Tally[];
  byAdmissionType: Tally[];
  byDepartment: Tally[];
  byFundingType: Tally[];
  byNationality: Tally[];
  admissions: { year: number; count: number }[];
  cohortByStatus: { year: number; status: string; count: number }[];
  /** The furthest verified workflow stage reached by each student file. */
  stageDistribution: { value: string; count: number }[];
  /** Measured elapsed time between dated workflow milestones. */
  stageTransit: { value: string; averageDays: number; sampleSize: number }[];
  gpaDistribution: { value: string; count: number }[];
  unitDistribution: { value: string; count: number }[];
  completeness: { complete: number; incomplete: number };
  progress: {
    averageGpa: number | null;
    averageUnits: number | null;
    averageSemesters: number | null;
  };
  attention: {
    unsupervised: number;
    unadvised: number;
    noField: number;
    noDegree: number;
    noDecision: number;
    oldUntouched: number;
    noAdmissionDate: number;
    uniqueStudents: number;
  };
  total: number;
  enrolled: number;
}

export async function studentReport(tenantId: string): Promise<StudentReport> {
  return readOnly(tenantId, async (tx) => {
    /*
     * All categorical breakdowns in one scan/round-trip. The previous shape
     * issued nine sequential GROUP BY statements over `students`; the lateral
     * values list unpivots the same row into named metrics while preserving the
     * one intentional difference: status covers all live students, the rest
     * only those currently enrolled.
     */
    const tallyRows = await tx.execute(sql`
      select metric, coalesce(nullif(value, ''), '') as value, count(*)::int as count
      from students s
      cross join lateral (values
        ('status', s.status, false),
        ('degree', s.degree, true),
        ('field', s.field_of_study, true),
        ('faculty', s.faculty, true),
        ('gender', s.gender, true),
        ('admissionType', s.admission_type, true),
        ('department', s.department, true),
        ('fundingType', s.funding_type, true),
        ('nationality', s.nationality, true)
      ) as breakdown(metric, value, enrolled_only)
      where s.deleted_at is null and (not breakdown.enrolled_only or s.status = 'enrolled')
      group by metric, value
      order by metric, count(*) desc, value`);

    const tallies = tallyRows.rows as { metric: string; value: string; count: number }[];
    const tally = (metric: string): Tally[] =>
      tallies
        .filter((row) => row.metric === metric)
        .map((row) => ({ value: row.value, count: Number(row.count) }));

    const byStatus = tally("status");
    const byDegree = tally("degree");
    const byField = tally("field");
    const byFaculty = tally("faculty");
    const byGender = tally("gender");
    const byAdmissionType = tally("admissionType");
    const byDepartment = tally("department");
    const byFundingType = tally("fundingType");
    const byNationality = tally("nationality");

    const admissionRows = await tx.execute(sql`
      select ${jalaliYear("admission_date")} as year, count(*)::int as count
      from students
      where deleted_at is null and admission_date is not null
      group by 1
      order by 1`);

    const cohortRows = await tx.execute(sql`
      select ${jalaliYear("admission_date")} as year, status, count(*)::int as count
      from students
      where deleted_at is null and admission_date is not null
      group by 1, status
      order by 1, status`);

    /*
     * One mutually-exclusive stage per file. Council appointments are the
     * authoritative supervisor-selection event; student supervisor columns are
     * retained only as a current-state fallback so incomplete files remain
     * visible rather than being silently downgraded to "registered".
     */
    const stageRows = await tx.execute(sql`
      with staged as (
        select
          case
            when s.status = 'graduated' then 'graduated'
            when exists (
              select 1 from council_decisions d
              where (d.student_id = s.id or (d.student_id is null and d.student_number = s.student_number))
                and d.deleted_at is null
                and d.report_category in (${sqlInList(FINAL_DEFENSE_DECISION_CATEGORIES)})
                and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            ) then 'final_defense'
            when exists (
              select 1 from council_decisions d
              where (d.student_id = s.id or (d.student_id is null and d.student_number = s.student_number))
                and d.deleted_at is null
                and d.report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
                and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            ) then 'proposal'
            when exists (
              select 1 from council_appointments a
              where (a.student_id = s.id or (a.student_id is null and a.student_number = s.student_number))
                and a.deleted_at is null
            ) then 'supervisor_selection'
            when s.primary_supervisor_id is not null
              or s.secondary_supervisor_id is not null
              or s.third_supervisor_id is not null then 'supervisor_assigned'
            else 'registered'
          end as stage
        from students s
        where s.deleted_at is null
      )
      select stage as value, count(*)::int as count
      from staged
      group by stage
      order by count(*) desc, stage`);

    /*
     * Transit metrics use only dated, authoritative workflow events. A missing
     * date simply removes that transition from the statistic; updated_at is not
     * used as a substitute for an academic milestone.
     */
    const stageTransitRows = await tx.execute(sql`
      with milestones as (
        select
          s.id,
          s.student_number,
          s.admission_date,
          (
            select min(a.meeting_date)
            from council_appointments a
            where (a.student_id = s.id or (a.student_id is null and a.student_number = s.student_number))
              and a.deleted_at is null
          ) as supervisor_selection_date,
          (
            select min(d.meeting_date)
            from council_decisions d
            where (d.student_id = s.id or (d.student_id is null and d.student_number = s.student_number))
              and d.deleted_at is null
              and d.report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
              and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
          ) as proposal_date,
          (
            select min(d.meeting_date)
            from council_decisions d
            where (d.student_id = s.id or (d.student_id is null and d.student_number = s.student_number))
              and d.deleted_at is null
              and d.report_category in (${sqlInList(FINAL_DEFENSE_DECISION_CATEGORIES)})
              and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})
          ) as final_defense_date
        from students s
        where s.deleted_at is null
      ), transitions as (
        select 'registered_to_supervisor_selection' as value,
               (supervisor_selection_date - admission_date)::int as days
        from milestones
        where admission_date is not null and supervisor_selection_date >= admission_date
        union all
        select 'supervisor_selection_to_proposal', (proposal_date - supervisor_selection_date)::int
        from milestones
        where supervisor_selection_date is not null and proposal_date >= supervisor_selection_date
        union all
        select 'proposal_to_final_defense', (final_defense_date - proposal_date)::int
        from milestones
        where proposal_date is not null and final_defense_date >= proposal_date
      )
      select value, round(avg(days)::numeric, 1)::float8 as average_days, count(*)::int as sample_size
      from transitions
      group by value
      order by case value
        when 'registered_to_supervisor_selection' then 1
        when 'supervisor_selection_to_proposal' then 2
        else 3
      end`);

    /*
     * Operational gaps are counted only over enrolled students. Decisions are
     * linked by the structured student id whenever present; the student number
     * is a fallback only for records that genuinely have no structured link.
     */
    const gaps = await tx.execute(sql`
      select
        count(*) filter (where primary_supervisor_id is null)::int as unsupervised,
        count(*) filter (where advisor_id is null)::int as unadvised,
        count(*) filter (where coalesce(field_of_study, '') = '')::int as no_field,
        count(*) filter (where coalesce(degree, '') = '')::int as no_degree,
        count(*) filter (
          where not exists (
            select 1 from council_decisions d
            where (d.student_id = students.id or (d.student_id is null and d.student_number = students.student_number))
              and d.deleted_at is null
              and d.report_category in (${sqlInList(STUDENT_DECISION_CATEGORIES)})
              and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)})))::int
          as no_decision,
        count(*) filter (where
          primary_supervisor_id is null or advisor_id is null or
          coalesce(field_of_study, '') = '' or coalesce(degree, '') = '' or
          not exists (
            select 1 from council_decisions d
            where (d.student_id = students.id or (d.student_id is null and d.student_number = students.student_number))
              and d.deleted_at is null
              and d.report_category in (${sqlInList(STUDENT_DECISION_CATEGORIES)})
              and d.review_status in (${sqlInList(VALID_DECISION_STATUSES)}))
        )::int as unique_students,
        count(*) filter (
          where admission_date is not null
            and admission_date < current_date - interval '365 days'
            and updated_at < now() - interval '180 days'
        )::int as old_untouched,
        count(*) filter (where admission_date is null)::int as no_admission_date
      from students
      where deleted_at is null and status = 'enrolled'`);

    const progressRows = await tx.execute(sql`
      select
        avg(overall_gpa)::float8 as average_gpa,
        avg(completed_units)::float8 as average_units,
        avg(semesters_count)::float8 as average_semesters,
        count(*) filter (where overall_gpa is not null)::int as gpa_count
      from students
      where deleted_at is null and status = 'enrolled'`);

    const gpaRows = await tx.execute(sql`
      select
        case
          when overall_gpa is null then 'missing'
          when overall_gpa < 10 then 'under10'
          when overall_gpa < 14 then '10to14'
          when overall_gpa < 17 then '14to17'
          else '17plus'
        end as value,
        count(*)::int as count
      from students
      where deleted_at is null and status = 'enrolled'
      group by 1
      order by min(overall_gpa) nulls last`);

    const unitRows = await tx.execute(sql`
      select
        case
          when completed_units is null then 'missing'
          when completed_units < 20 then 'under20'
          when completed_units < 50 then '20to50'
          when completed_units < 100 then '50to100'
          else '100plus'
        end as value,
        count(*)::int as count
      from students
      where deleted_at is null and status = 'enrolled'
      group by 1
      order by min(completed_units) nulls last`);

    const completenessRows = await tx.execute(sql`
      select
        count(*) filter (where
          nullif(btrim(coalesce(degree, '')), '') is not null and
          nullif(btrim(coalesce(field_of_study, '')), '') is not null and
          primary_supervisor_id is not null and
          admission_date is not null
        )::int as complete,
        count(*) filter (where
          nullif(btrim(coalesce(degree, '')), '') is null or
          nullif(btrim(coalesce(field_of_study, '')), '') is null or
          primary_supervisor_id is null or
          admission_date is null
        )::int as incomplete
      from students
      where deleted_at is null and status = 'enrolled'`);

    const gap = (gaps.rows[0] ?? {}) as Record<string, number | string>;
    const progress = (progressRows.rows[0] ?? {}) as {
      average_gpa?: number | string | null;
      average_units?: number | string | null;
      average_semesters?: number | string | null;
    };
    const average = (value: number | string | null | undefined) =>
      value === null || value === undefined ? null : Number(value);

    return {
      byStatus,
      byDegree,
      byField,
      byFaculty,
      byGender,
      byAdmissionType,
      byDepartment,
      byFundingType,
      byNationality,
      admissions: (admissionRows.rows as { year: number; count: number }[]).map((row) => ({
        year: Number(row.year),
        count: Number(row.count),
      })),
      cohortByStatus: (cohortRows.rows as { year: number; status: string; count: number }[]).map(
        (row) => ({
          year: Number(row.year),
          status: String(row.status ?? ""),
          count: Number(row.count),
        }),
      ),
      stageDistribution: (stageRows.rows as { value: string; count: number }[]).map((row) => ({
        value: String(row.value),
        count: Number(row.count),
      })),
      stageTransit: (
        stageTransitRows.rows as {
          value: string;
          average_days: number;
          sample_size: number;
        }[]
      ).map((row) => ({
        value: String(row.value),
        averageDays: Number(row.average_days),
        sampleSize: Number(row.sample_size),
      })),
      gpaDistribution: (gpaRows.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      unitDistribution: (unitRows.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      completeness: {
        complete: Number(
          (completenessRows.rows[0] as { complete?: number } | undefined)?.complete ?? 0,
        ),
        incomplete: Number(
          (completenessRows.rows[0] as { incomplete?: number } | undefined)?.incomplete ?? 0,
        ),
      },
      progress: {
        averageGpa: average(progress.average_gpa),
        averageUnits: average(progress.average_units),
        averageSemesters: average(progress.average_semesters),
      },
      attention: {
        unsupervised: Number(gap.unsupervised ?? 0),
        unadvised: Number(gap.unadvised ?? 0),
        noField: Number(gap.no_field ?? 0),
        noDegree: Number(gap.no_degree ?? 0),
        noDecision: Number(gap.no_decision ?? 0),
        oldUntouched: Number(gap.old_untouched ?? 0),
        noAdmissionDate: Number(gap.no_admission_date ?? 0),
        uniqueStudents: Number(gap.unique_students ?? 0),
      },
      total: byStatus.reduce((sum, row) => sum + row.count, 0),
      enrolled: byStatus.find((row) => row.value === "enrolled")?.count ?? 0,
    };
  });
}
