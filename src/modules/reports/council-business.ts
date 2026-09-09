import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import { FINAL_DEFENSE_DECISION_CATEGORIES, sqlInList } from "@/lib/council-stage-policy.ts";
import { inYear, jalaliYear, reportIdentifier, type Tally } from "./shared.ts";

/* ── Council decisions ────────────────────────────────────────────────────── */

export interface DecisionReport {
  byCategory: Tally[];
  byStatus: Tally[];
  byYear: { year: number; count: number }[];
  byResearchType: Tally[];
  byDegree: Tally[];
  byField: Tally[];
  attention: { pending: number; noDefenceDate: number; noBoard: number; noRepresentative: number };
  total: number;
}

export interface CouncilBusinessReport {
  decisions: DecisionReport;
  rulings: {
    byCategory: Tally[];
    byStatus: Tally[];
    byYear: { year: number; count: number }[];
    attention: { pending: number; noText: number; noCategory: number };
    total: number;
  };
  appointments: {
    byDegree: Tally[];
    byField: Tally[];
    byYear: { year: number; count: number }[];
    attention: { noStudent: number; noDegree: number; noField: number; noPrimary: number };
    total: number;
    distinctStudents: number;
  };
  byKind: Tally[];
  byYear: { year: number; count: number }[];
  total: number;
}

export async function councilBusinessReport(
  tenantId: string,
  year: number | null,
): Promise<CouncilBusinessReport> {
  return readOnly(tenantId, async (tx) => {
    const tally = async (table: string, column: string) => {
      const result = await tx.execute(sql`
        select coalesce(nullif(${reportIdentifier(column, "column")}, ''), '') as value, count(*)::int as count
        from ${reportIdentifier(table, "table")}
        where deleted_at is null ${inYear("meeting_date", year)}
        group by 1
        order by count(*) desc, 1`);
      return (result.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      }));
    };

    const yearly = async (table: string) => {
      const result = await tx.execute(sql`
        select ${jalaliYear("meeting_date")} as year, count(*)::int as count
        from ${reportIdentifier(table, "table")}
        where deleted_at is null and meeting_date is not null ${inYear("meeting_date", year)}
        group by 1 order by 1`);
      return (result.rows as { year: number; count: number }[]).map((row) => ({
        year: Number(row.year),
        count: Number(row.count),
      }));
    };

    /*
     * These helpers all use the transaction client captured above. A
     * node-postgres transaction is backed by one client, so Promise.all here
     * attempts to put several statements on the same client at once. It may
     * appear faster, but pg warns (and newer versions can reject it) because a
     * client cannot execute concurrent queries. Keep the work ordered inside
     * the transaction; the database can still use its own query plan and we
     * preserve the one-snapshot consistency that makes this report meaningful.
     */
    const decisionCategory = await tally("council_decisions", "report_category");
    const decisionStatus = await tally("council_decisions", "review_status");
    const decisionResearch = await tally("council_decisions", "research_type");
    const decisionDegree = await tally("council_decisions", "education_level");
    const decisionField = await tally("council_decisions", "field_of_study");
    const rulingCategory = await tally("council_rulings", "report_category");
    const rulingStatus = await tally("council_rulings", "review_status");
    const appointmentDegree = await tally("council_appointments", "education_level");
    const appointmentField = await tally("council_appointments", "field_of_study");
    const decisionByYear = await yearly("council_decisions");
    const rulingByYear = await yearly("council_rulings");
    const appointmentByYear = await yearly("council_appointments");

    /*
     * The gaps that stop a dossier moving.
     *
     * `no_board` is «not one of the three examiner seats is filled», not «fewer
     * than three»: a board of two is a decision the council took, and a board of
     * none is a dossier nobody can schedule.
     */
    const gaps = await tx.execute(sql`
      select
        count(*) filter (where review_status in ('pending', 're_review'))::int as pending,
        count(*) filter (
          where report_category in (${sqlInList(FINAL_DEFENSE_DECISION_CATEGORIES)})
            and defense_meeting_date is null)::int as no_defence_date,
        count(*) filter (
          where coalesce(btrim(reviewer1), '') = ''
            and coalesce(btrim(reviewer2), '') = ''
            and coalesce(btrim(reviewer3), '') = '')::int as no_board,
        count(*) filter (
          where coalesce(btrim(graduate_studies_representative), '') = '')::int
          as no_representative
      from council_decisions
      where deleted_at is null ${inYear("meeting_date", year)}`);

    const gap = (gaps.rows[0] ?? {}) as Record<string, number | string>;

    const rulingGaps = await tx.execute(sql`
      select count(*) filter (where review_status in ('pending', 're_review'))::int as pending,
        count(*) filter (where coalesce(btrim(decision_text), '') = '')::int as no_text,
        count(*) filter (where coalesce(btrim(report_category), '') = '')::int as no_category
      from council_rulings where deleted_at is null ${inYear("meeting_date", year)}`);
    const rulingGap = (rulingGaps.rows[0] ?? {}) as Record<string, number | string>;

    const appointmentGaps = await tx.execute(sql`
      select count(*) filter (where coalesce(btrim(student_number), '') = '' and coalesce(btrim(student_name), '') = '')::int as no_student,
        count(*) filter (where coalesce(btrim(education_level), '') = '')::int as no_degree,
        count(*) filter (where coalesce(btrim(field_of_study), '') = '')::int as no_field,
        count(*) filter (where primary_supervisor_id is null)::int as no_primary,
        count(distinct student_id)::int as distinct_students
      from council_appointments where deleted_at is null ${inYear("meeting_date", year)}`);
    const appointmentGap = (appointmentGaps.rows[0] ?? {}) as Record<string, number | string>;

    const byKindResult = await tx.execute(sql`
      select value, count(*)::int as count from (
        select 'decisions' as value from council_decisions where deleted_at is null ${inYear("meeting_date", year)}
        union all select 'rulings' from council_rulings where deleted_at is null ${inYear("meeting_date", year)}
        union all select 'appointments' from council_appointments where deleted_at is null ${inYear("meeting_date", year)}
      ) business group by value order by count desc, value`);
    const byKind = (byKindResult.rows as { value: string; count: number }[]).map((row) => ({
      value: row.value,
      count: Number(row.count),
    }));

    const byYearResult = await tx.execute(sql`
      select year, sum(count)::int as count from (
        select ${jalaliYear("meeting_date")} as year, count(*)::int as count from council_decisions where deleted_at is null and meeting_date is not null group by 1
        union all select ${jalaliYear("meeting_date")} as year, count(*)::int from council_rulings where deleted_at is null and meeting_date is not null group by 1
        union all select ${jalaliYear("meeting_date")} as year, count(*)::int from council_appointments where deleted_at is null and meeting_date is not null group by 1
      ) totals group by year order by year`);
    const byYear = (byYearResult.rows as { year: number; count: number }[])
      .filter((row) => year === null || Number(row.year) === year)
      .map((row) => ({ year: Number(row.year), count: Number(row.count) }));

    const decisions: DecisionReport = {
      byCategory: decisionCategory,
      byStatus: decisionStatus,
      byResearchType: decisionResearch,
      byDegree: decisionDegree,
      byField: decisionField,
      byYear: decisionByYear,
      attention: {
        pending: Number(gap.pending ?? 0),
        noDefenceDate: Number(gap.no_defence_date ?? 0),
        noBoard: Number(gap.no_board ?? 0),
        noRepresentative: Number(gap.no_representative ?? 0),
      },
      total: decisionCategory.reduce((sum, row) => sum + row.count, 0),
    };
    const rulings = {
      byCategory: rulingCategory,
      byStatus: rulingStatus,
      byYear: rulingByYear,
      attention: {
        pending: Number(rulingGap.pending ?? 0),
        noText: Number(rulingGap.no_text ?? 0),
        noCategory: Number(rulingGap.no_category ?? 0),
      },
      total: rulingCategory.reduce((sum, row) => sum + row.count, 0),
    };
    const appointments = {
      byDegree: appointmentDegree,
      byField: appointmentField,
      byYear: appointmentByYear,
      attention: {
        noStudent: Number(appointmentGap.no_student ?? 0),
        noDegree: Number(appointmentGap.no_degree ?? 0),
        noField: Number(appointmentGap.no_field ?? 0),
        noPrimary: Number(appointmentGap.no_primary ?? 0),
      },
      total: appointmentDegree.reduce((sum, row) => sum + row.count, 0),
      distinctStudents: Number(appointmentGap.distinct_students ?? 0),
    };

    return {
      decisions,
      rulings,
      appointments,
      byKind,
      byYear,
      total: byKind.reduce((sum, row) => sum + row.count, 0),
    };
  });
}

export async function decisionReport(tenantId: string): Promise<DecisionReport> {
  return (await councilBusinessReport(tenantId, null)).decisions;
}
