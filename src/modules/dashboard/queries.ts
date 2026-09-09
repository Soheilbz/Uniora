import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  councilDecisions,
  councilMeetings,
  professors,
  reportingSnapshots,
  students,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { logError } from "@/lib/logger.ts";
import { AWAITING_REVIEW } from "@/modules/council/model.ts";

/**
 * What the dashboard counts, and what it does when it cannot count.
 *
 * ── A number, or the absence of one ─────────────────────────────────────────
 *
 * Every figure here is `number | null`, and the null is the entire design. A
 * count that failed and a count that is genuinely zero are different facts about
 * an institution, and the application spent real incidents learning that
 * rendering them the same way tells an office its records are gone. So a failed
 * read comes back as null and the card shows «—» instead of a confident 0.
 *
 * ── One transaction, not nine ───────────────────────────────────────────────
 *
 * Every query here runs inside a single read-only transaction. That is not a
 * micro-optimisation at this size: with a couple of thousand people opening this
 * page at the start of the working day, nine short transactions per viewer is
 * nine times the connection churn through PgBouncer for figures that are read
 * together and displayed together.
 *
 * It is also the only way the figures agree with each other. Separate
 * transactions can straddle a write, and a dashboard showing a decision count
 * from before an import beside a student count from after is a dashboard
 * somebody will eventually try to reconcile.
 */

export interface RecentDecision {
  id: string;
  /**
   * Text, not a number, and that is the archive's decision rather than a
   * modelling slip: sittings are minuted as «۶۷۹» and occasionally as «۶۷۹
   * (فوق‌العاده)». Storing it as an integer would have to reject the second, and
   * the second is a real sitting with real decisions in it.
   */
  meetingNumber: string | null;
  meetingDate: string | null;
  thesisTitle: string | null;
  studentName: string | null;
}

export interface AdmissionYear {
  /** The Jalali year the admission falls in — «۱۴۰۳», not «۲۰۲۴». */
  year: number;
  count: number;
}

export interface DegreeSlice {
  value: string;
  count: number;
}

/**
 * The sitting the council last held, and what came out of it.
 *
 * The card exists because it is the first question anybody opening this screen
 * asks — «آخرین جلسه کِی بود و چه تصویب شد» — and answering it with a link into
 * the sittings register is two navigations away from the answer.
 */
export interface LastSitting {
  id: string;
  number: string | null;
  date: string | null;
  location: string | null;
  /** How many dossiers were minuted at it. */
  decisions: number;
}

/**
 * Something the office should look at, with the number that makes it urgent.
 *
 * `count` is nullable for the same reason every figure here is: a signal that
 * could not be read must not render as «nothing pending», which is the one
 * reading that would make somebody stop looking.
 */
export interface AttentionSignal {
  kind: "unsupervised" | "pendingReview" | "defencesSoon";
  count: number | null;
  href: string;
  /** The extra clause a signal earns when there is something to say. */
  detail: string | null;
}

export interface DashboardCounts {
  students: number | null;
  /** Those actually studying — the figure the office quotes. */
  enrolled: number | null;
  professors: number | null;
  decisions: number | null;
  /** Distinct sittings minuted in the last ninety days. */
  recentMeetings: number | null;
  /** The year the archive opens at, read off the oldest decision on file. */
  firstDecisionDate: string | null;
  recent: RecentDecision[] | null;
  admissions: AdmissionYear[] | null;
  degrees: DegreeSlice[] | null;
  /** Enrolled students with no supervisor recorded — something to act on. */
  unsupervised: number | null;
  /** Dossiers the council has not ruled on yet. */
  pendingReview: number | null;
  /** How long the oldest of them has been waiting, in days. */
  pendingOldestDays: number | null;
  /** The sitting that oldest decision was minuted at. */
  pendingOldestMeeting: string | null;
  /** Defences falling inside the horizon below. */
  defencesSoon: number | null;
  lastSitting: LastSitting | null;
}

const UNREADABLE: DashboardCounts = {
  students: null,
  enrolled: null,
  professors: null,
  decisions: null,
  recentMeetings: null,
  firstDecisionDate: null,
  recent: null,
  admissions: null,
  degrees: null,
  unsupervised: null,
  pendingReview: null,
  pendingOldestDays: null,
  pendingOldestMeeting: null,
  defencesSoon: null,
  lastSitting: null,
};

/** How far back «جلسات شورا» looks. One academic quarter. */
export const RECENT_DAYS = 90;
/** How many years the admissions chart spans. */
export const ADMISSION_SPAN = 6;

/**
 * How far ahead «دفاع‌های نزدیک» looks.
 *
 * Thirty days, because that is the window in which the office can still do
 * something about a defence: book a room, chase a missing examiner, print the
 * notice. A horizon of a week would surface each one too late to act, and a
 * horizon of a term would make the number a standing figure nobody reads.
 */
export const DEFENCE_HORIZON_DAYS = 30;

/*
 * The review states are the council's own vocabulary and live with it — the
 * attention bell counts the same backlog, and two spellings of «what the
 * council still owes an answer on» is how two screens come to disagree about
 * one registry.
 */
export { AWAITING_REVIEW };

export async function dashboardCounts(tenantId: string): Promise<DashboardCounts> {
  try {
    return await readOnly(tenantId, async (tx) => {
      /*
       * `deletedAt is null` on every count, because this schema retires rows
       * rather than removing them — a student who left is still the subject of
       * council decisions that must keep resolving. Counting them would report
       * an enrolment the office does not have.
       */
      const live = isNull(students.deletedAt);

      // Prefer the asynchronously maintained projection for heavyweight global
      // totals when it is fresh, while retaining direct SQL as a correctness
      // fallback. Detailed dashboard slices below still read their canonical
      // tables in this same transaction.
      const [projectionRow] = await tx
        .select({
          payload: reportingSnapshots.payloadJson,
          calculatedAt: reportingSnapshots.calculatedAt,
        })
        .from(reportingSnapshots)
        .where(
          and(
            eq(reportingSnapshots.projection, "dashboard"),
            eq(reportingSnapshots.periodKey, "current"),
          ),
        )
        .limit(1);
      let projected: { students?: number; professors?: number; councilDecisions?: number } | null =
        null;
      if (projectionRow && Date.now() - projectionRow.calculatedAt.getTime() <= 15 * 60 * 1000) {
        try {
          const candidate = JSON.parse(projectionRow.payload) as Record<string, unknown>;
          projected = {};
          if (Number.isFinite(Number(candidate.students)))
            projected.students = Number(candidate.students);
          if (Number.isFinite(Number(candidate.professors)))
            projected.professors = Number(candidate.professors);
          if (Number.isFinite(Number(candidate.councilDecisions)))
            projected.councilDecisions = Number(candidate.councilDecisions);
        } catch {
          projected = null;
        }
      }

      const [studentRow] =
        projected?.students === undefined
          ? await tx.select({ value: count() }).from(students).where(live)
          : [{ value: projected.students }];

      const [enrolledRow] = await tx
        .select({ value: count() })
        .from(students)
        .where(and(live, eq(students.status, "enrolled")));

      const [professorRow] =
        projected?.professors === undefined
          ? await tx.select({ value: count() }).from(professors).where(isNull(professors.deletedAt))
          : [{ value: projected.professors }];

      const [decisionRow] =
        projected?.councilDecisions === undefined
          ? await tx
              .select({ value: count() })
              .from(councilDecisions)
              .where(isNull(councilDecisions.deletedAt))
          : [{ value: projected.councilDecisions }];

      const [firstRow] = await tx
        .select({ date: sql<string | null>`min(${councilDecisions.meetingDate})` })
        .from(councilDecisions)
        .where(isNull(councilDecisions.deletedAt));

      /*
       * Distinct *sittings*, not decisions. Several decisions are routinely
       * minuted at one sitting, so counting rows would report a council that
       * met five times as often as it did.
       */
      const [meetingsRow] = await tx
        .select({ value: countDistinct(councilDecisions.meetingNumber) })
        .from(councilDecisions)
        .where(
          and(
            isNull(councilDecisions.deletedAt),
            /*
             * `make_interval`, not `current_date - ${RECENT_DAYS}`.
             *
             * A bound parameter arrives as an integer, and PostgreSQL has no
             * `date >= integer` — the subtraction that works when the number is
             * written into the SQL fails the moment it becomes a placeholder.
             * `make_interval(days => …)` takes the integer and produces the
             * interval the date arithmetic actually wants.
             */
            gte(
              councilDecisions.meetingDate,
              sql`current_date - make_interval(days => ${RECENT_DAYS})`,
            ),
          ),
        );

      const [unsupervisedRow] = await tx
        .select({ value: count() })
        .from(students)
        .where(and(live, eq(students.status, "enrolled"), isNull(students.primarySupervisorId)));

      const [pendingRow] = await tx
        .select({ value: count() })
        .from(councilDecisions)
        .where(
          and(
            isNull(councilDecisions.deletedAt),
            inArray(councilDecisions.reviewStatus, [...AWAITING_REVIEW]),
          ),
        );

      /*
       * How long the oldest unruled dossier has waited.
       *
       * The count alone does not distinguish «۱۲ مورد از جلسه‌ی هفته‌ی پیش» from
       * «۱۲ مورد که یکی‌شان شش ماه است منتظر است», and only the second is a
       * problem. Read as a separate row rather than folded into the count,
       * because the two answer different questions and one may legitimately be
       * absent — a queue with nothing in it has no oldest member.
       */
      const [oldestRow] = await tx
        .select({
          days: sql<number | null>`(current_date - ${councilDecisions.meetingDate})`,
          /* The sitting it came from, so the warning can name it: «the oldest
             is from sitting 680, 110 days ago» is actionable where a bare
             number of days is only alarming. */
          meeting: councilDecisions.meetingNumber,
        })
        .from(councilDecisions)
        .where(
          and(
            isNull(councilDecisions.deletedAt),
            inArray(councilDecisions.reviewStatus, [...AWAITING_REVIEW]),
            sql`${councilDecisions.meetingDate} is not null`,
          ),
        )
        .orderBy(asc(councilDecisions.meetingDate))
        .limit(1);

      const [defencesRow] = await tx
        .select({ value: count() })
        .from(councilDecisions)
        .where(
          and(
            isNull(councilDecisions.deletedAt),
            gte(councilDecisions.defenseMeetingDate, sql`current_date`),
            sql`${councilDecisions.defenseMeetingDate} <= current_date + make_interval(days => ${DEFENCE_HORIZON_DAYS})`,
          ),
        );

      /*
       * The last sitting, from the sittings register rather than from the
       * decisions minuted at it.
       *
       * A sitting is a row in `council_meetings`; a decision merely carries the
       * number it was minuted under. Reading the latest decision would report
       * the last sitting that *produced* something, and a sitting held last week
       * that adjourned without a resolution is still the last sitting.
       */
      const [sittingRow] = await tx
        .select({
          id: councilMeetings.id,
          number: councilMeetings.meetingNumber,
          date: councilMeetings.meetingDate,
          location: councilMeetings.meetingLocation,
          decisions: sql<number>`(
            select count(*) from council_decisions d
            where d.meeting_id = council_meetings.id and d.deleted_at is null)`.mapWith(Number),
        })
        .from(councilMeetings)
        .where(isNull(councilMeetings.deletedAt))
        .orderBy(desc(councilMeetings.meetingDate), desc(councilMeetings.meetingNumber))
        .limit(1);

      const recent = await tx
        .select({
          id: councilDecisions.id,
          meetingNumber: councilDecisions.meetingNumber,
          meetingDate: councilDecisions.meetingDate,
          thesisTitle: councilDecisions.thesisTitle,
          studentName: councilDecisions.studentName,
        })
        .from(councilDecisions)
        .where(isNull(councilDecisions.deletedAt))
        /*
         * Newest sitting first, and the number breaks ties within a day —
         * several decisions are routinely minuted at one sitting, and ordering
         * by date alone would shuffle them differently on every render.
         */
        .orderBy(desc(councilDecisions.meetingDate), desc(councilDecisions.meetingNumber))
        .limit(6);

      /*
       * Admissions by Jalali year, grouped in SQL.
       *
       * Grouped rather than read and bucketed in JavaScript: on an archive of
       * forty thousand records the second approach is forty thousand rows
       * crossing the wire to produce six numbers.
       *
       * ── Why the year is computed rather than extracted ────────────────────
       *
       * `extract(year …)` gives the Gregorian year, and this interface is read
       * in Jalali — «۲۰۲۴» on the axis of a Persian chart is a year nobody in
       * the office uses. Grouping by the Gregorian year and relabelling it is
       * also wrong rather than merely ugly: a Gregorian year spans two Jalali
       * ones, so admissions from Bahman and from Mehr of what the office calls
       * different years would land in one column.
       *
       * The boundary is the database's shared Borkowski Jalaali conversion,
       * rather than an assumed March 21. Nowruz can fall on March 20, and a
       * report must not misclassify that boundary day even if admissions rarely
       * happen there.
       */
      const jalaliYear = sql<number>`app.jalali_year(${students.admissionDate})`;

      const admissions = await tx
        .select({ year: jalaliYear.mapWith(Number), value: count() })
        .from(students)
        .where(and(live, sql`${students.admissionDate} is not null`))
        .groupBy(jalaliYear)
        .orderBy(sql`1 desc`)
        .limit(ADMISSION_SPAN);

      const degrees = await tx
        .select({ value: students.degree, total: count() })
        .from(students)
        .where(and(live, eq(students.status, "enrolled"), sql`${students.degree} is not null`))
        .groupBy(students.degree)
        .orderBy(desc(count()));

      return {
        students: studentRow?.value ?? 0,
        enrolled: enrolledRow?.value ?? 0,
        professors: professorRow?.value ?? 0,
        decisions: decisionRow?.value ?? 0,
        recentMeetings: meetingsRow?.value ?? 0,
        firstDecisionDate: firstRow?.date ?? null,
        unsupervised: unsupervisedRow?.value ?? 0,
        pendingReview: pendingRow?.value ?? 0,
        /* Null rather than zero when the queue is empty: «۰ روز» would read as
           a dossier filed this morning rather than as no queue at all. */
        pendingOldestDays: oldestRow?.days ?? null,
        pendingOldestMeeting: oldestRow?.meeting ?? null,
        defencesSoon: defencesRow?.value ?? 0,
        lastSitting: sittingRow
          ? {
              id: sittingRow.id,
              number: sittingRow.number ?? null,
              date: sittingRow.date ?? null,
              location: sittingRow.location ?? null,
              decisions: sittingRow.decisions,
            }
          : null,
        recent: recent.map((row) => ({
          id: row.id,
          meetingNumber: row.meetingNumber ?? null,
          meetingDate: row.meetingDate ?? null,
          thesisTitle: row.thesisTitle ?? null,
          studentName: row.studentName ?? null,
        })),
        // Oldest year first, so the chart reads left to right in time even in a
        // right-to-left document — the axis is time, not text.
        admissions: admissions
          .map((row) => ({ year: row.year, count: row.value }))
          .sort((a, b) => a.year - b.year),
        degrees: degrees
          .filter((row): row is { value: string; total: number } => row.value !== null)
          .map((row) => ({ value: row.value, count: row.total })),
      };
    });
  } catch (cause) {
    /*
     * Logged here and reported as null to the screen, never thrown into the
     * render. A dashboard is the first thing an office opens in the morning; a
     * database that is briefly unreachable should cost them the numbers, not the
     * application.
     *
     * The message is deliberately not passed to the client: a Drizzle error
     * quotes the failing statement and its bound parameters, and this page's
     * parameters are a tenant identifier.
     */
    logError("dashboard.counts_read_failed", cause, { tenantId });
    return UNREADABLE;
  }
}
