import { type SQL, sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";

/**
 * What the six reports count.
 *
 * ── One snapshot per report, not one transaction per figure ─────────────────
 *
 * Each report runs its related reads inside one read-only transaction so every
 * panel sees one tenant-scoped snapshot. Expensive repeated categorical scans
 * are consolidated where practical; distinct analytical questions stay as
 * separate SQL statements when that keeps the query plan and intent clearer.
 *
 * ── Grouped in SQL, shaped in TypeScript ────────────────────────────────────
 *
 * The grouping, the Jalali year and the buckets are the database's work:
 * PostgreSQL groups a hundred thousand rows faster than JavaScript reads them,
 * and the alternative is fetching every student to count them by field. What
 * comes back is already the shape a panel draws.
 */

/** A labelled count, which is what most of these panels are. */
export interface Tally {
  value: string;
  count: number;
}

const REPORT_TABLES = new Set([
  "council_decisions",
  "council_rulings",
  "council_appointments",
  "council_meetings",
  "workshops",
]);

const REPORT_COLUMNS = new Set([
  "meeting_date",
  "workshop_date",
  "status",
  "degree",
  "field_of_study",
  "faculty",
  "gender",
  "admission_type",
  "department",
  "funding_type",
  "nationality",
  "university",
  "academic_rank",
  "report_category",
  "review_status",
  "research_type",
  "education_level",
]);

export function reportIdentifier(value: string, kind: "table" | "column"): SQL {
  const allowed = kind === "table" ? REPORT_TABLES : REPORT_COLUMNS;
  if (!allowed.has(value)) throw new Error(`Unsupported report ${kind}: ${value}`);
  return sql.raw(value);
}

/**
 * The Jalaali year a Gregorian date falls in.
 *
 * `app.jalali_year(date)` is installed before the table migrations and uses the
 * same break-year calendar model as the application's Jalaali date tooling. A
 * fixed March-21 boundary is not correct in every year and can move a sitting
 * at Nowruz into the wrong report period.
 */
export function jalaliYear(column: string): SQL {
  if (
    column !== "meeting_date" &&
    column !== "admission_date" &&
    column !== "workshop_date" &&
    column !== "m.meeting_date" &&
    column !== "w.workshop_date"
  ) {
    throw new Error(`Unsupported report date column: ${column}`);
  }
  return sql.raw(`app.jalali_year(${column})`);
}

/**
 * A year filter, or nothing.
 *
 * `sql.empty()` rather than `1 = 1`: an unnarrowed report should produce the
 * statement it would have produced anyway, so the plan a DBA reads is the plan
 * that ran.
 */
export function inYear(column: string, year: number | null): SQL {
  return year === null ? sql.empty() : sql` and ${jalaliYear(column)} = ${year}`;
}

/** Every Jalali year a column holds rows in, newest first. */
async function yearsOf(tenantId: string, table: string, column: string): Promise<number[]> {
  const result = await readOnly(tenantId, (tx) =>
    tx.execute(sql`
      select distinct ${jalaliYear(column)} as year
      from ${reportIdentifier(table, "table")}
      where deleted_at is null and ${reportIdentifier(column, "column")} is not null
      order by 1 desc`),
  );
  return (result.rows as { year: number }[]).map((row) => Number(row.year));
}

export const meetingYears = (tenantId: string) =>
  yearsOf(tenantId, "council_meetings", "meeting_date");
export const workshopYears = (tenantId: string) => yearsOf(tenantId, "workshops", "workshop_date");
export const reviewYears = (tenantId: string) =>
  yearsOf(tenantId, "council_decisions", "meeting_date");

export async function councilBusinessYears(tenantId: string): Promise<number[]> {
  return readOnly(tenantId, async (tx) => {
    const result = await tx.execute(sql`
      select distinct year from (
        select ${jalaliYear("meeting_date")} as year from council_decisions where deleted_at is null and meeting_date is not null
        union select ${jalaliYear("meeting_date")} as year from council_rulings where deleted_at is null and meeting_date is not null
        union select ${jalaliYear("meeting_date")} as year from council_appointments where deleted_at is null and meeting_date is not null
      ) years order by year desc`);
    return (result.rows as { year: number }[]).map((row) => Number(row.year));
  });
}
