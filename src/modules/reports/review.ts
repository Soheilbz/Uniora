import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import {
  PROPOSAL_DECISION_CATEGORIES,
  sqlInList,
  VALID_DECISION_STATUSES,
} from "@/lib/council-stage-policy.ts";
import { inYear, type Tally } from "./shared.ts";

/* ── Examining ────────────────────────────────────────────────────────────── */

export interface ReviewReport {
  /** How long a dossier waits between the board being set and the defence. */
  pace: { average: number | null; median: number | null; longest: number | null };
  /** Those cases bucketed by how long they took. */
  paceSpread: Tally[];
  /** Cases examined, by the degree of the dossier. */
  byLevel: Tally[];
  attention: { noRepresentative: number; outstanding: number };
  /** How many approved proposal decisions the tally was counted from. */
  decisions: number;
  /** How many dossiers the pace figures were measured over. */
  paceCases: number;
}

/**
 * How the examining actually runs, beside the tally of who does it.
 *
 * ── What "pace" measures, and what it cannot ────────────────────────────────
 *
 * The distance between the sitting that appointed a board and the day the
 * defence was held. Both are columns on the same decision, so this is one
 * subtraction and not a join across two sittings — which is what makes it
 * trustworthy: a dossier is one row and the two dates are its own.
 *
 * Only dossiers that *reached* a defence are counted. Including the ones still
 * waiting would make the average shorter every time a new proposal was
 * approved, which is the opposite of what the number is for.
 */
export async function reviewReport(
  tenantId: string,
  year: number | null = null,
): Promise<ReviewReport> {
  return readOnly(tenantId, async (tx) => {
    const waits = await tx.execute(sql`
      select (defense_meeting_date - meeting_date)::int as days
      from council_decisions
      where deleted_at is null
        and report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
        and review_status in (${sqlInList(VALID_DECISION_STATUSES)})
        and meeting_date is not null
        and defense_meeting_date is not null
        and defense_meeting_date >= meeting_date
        ${inYear("meeting_date", year)}
      order by 1`);

    const days = (waits.rows as { days: number }[]).map((row) => Number(row.days));
    const months = days.map((value) => value / 30.44);

    const byLevel = await tx.execute(sql`
      select coalesce(nullif(education_level, ''), '') as value, count(*)::int as count
      from council_decisions
      where deleted_at is null
        and report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
        and review_status in (${sqlInList(VALID_DECISION_STATUSES)})
        and (coalesce(btrim(reviewer1), '') <> ''
          or coalesce(btrim(reviewer2), '') <> ''
          or coalesce(btrim(reviewer3), '') <> ''
          or coalesce(btrim(reviewer4_invited), '') <> '')
        ${inYear("meeting_date", year)}
      group by 1
      order by count(*) desc, 1`);

    const gaps = await tx.execute(sql`
      select
        count(*) filter (
          where coalesce(btrim(graduate_studies_representative), '') = ''
            and report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
            and review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            and (coalesce(btrim(reviewer1), '') <> ''
              or coalesce(btrim(reviewer2), '') <> ''
              or coalesce(btrim(reviewer3), '') <> ''
              or coalesce(btrim(reviewer4_invited), '') <> ''))::int as no_representative,
        /*
         * Boards appointed whose defence has not been minuted.
         *
         * The board is set and no day is on the record — the state the office
         * chases. A dossier with no board at all is a different gap and belongs
         * to the decisions report, not this one.
         */
        count(*) filter (
          where defense_meeting_date is null
            and report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
            and review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            and (coalesce(btrim(reviewer1), '') <> ''
              or coalesce(btrim(reviewer2), '') <> ''
              or coalesce(btrim(reviewer3), '') <> ''
              or coalesce(btrim(reviewer4_invited), '') <> ''))::int as outstanding,
        count(*) filter (
          where report_category in (${sqlInList(PROPOSAL_DECISION_CATEGORIES)})
            and review_status in (${sqlInList(VALID_DECISION_STATUSES)})
            and (
              coalesce(btrim(reviewer1), '') <> ''
            or coalesce(btrim(reviewer2), '') <> ''
            or coalesce(btrim(reviewer3), '') <> ''
            or coalesce(btrim(reviewer4_invited), '') <> ''))::int as decisions
      from council_decisions
      where deleted_at is null ${inYear("meeting_date", year)}`);

    const gap = (gaps.rows[0] ?? {}) as Record<string, number | string>;

    const bucket = (value: number) =>
      value < 6 ? "under6" : value < 12 ? "under12" : value < 18 ? "under18" : "over18";
    const spread = new Map<string, number>([
      ["under6", 0],
      ["under12", 0],
      ["under18", 0],
      ["over18", 0],
    ]);
    for (const value of months) {
      const key = bucket(value);
      spread.set(key, (spread.get(key) ?? 0) + 1);
    }

    const round = (value: number) => Math.round(value * 10) / 10;

    return {
      pace: {
        /* Null rather than nought where nothing has reached a defence: «۰ ماه»
           would read as instantaneous rather than as no measurement. */
        average:
          months.length === 0
            ? null
            : round(months.reduce((sum, value) => sum + value, 0) / months.length),
        /* The median as well as the mean, because one long-delayed dossier
           moves the mean and the median says where the middle actually is. */
        median: months.length === 0 ? null : round(months[Math.floor(months.length / 2)] ?? 0),
        longest: months.length === 0 ? null : round(Math.max(...months)),
      },
      paceSpread: [...spread].map(([value, count]) => ({ value, count })),
      paceCases: months.length,
      byLevel: (byLevel.rows as { value: string; count: number }[]).map((row) => ({
        value: row.value,
        count: Number(row.count),
      })),
      attention: {
        noRepresentative: Number(gap.no_representative ?? 0),
        outstanding: Number(gap.outstanding ?? 0),
      },
      decisions: Number(gap.decisions ?? 0),
    };
  });
}
