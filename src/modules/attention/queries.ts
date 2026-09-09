import { and, eq, sql } from "drizzle-orm";
import { attentionSummary } from "@/db/schema.ts";
import { readOnly, withTenant as writeTenant } from "@/db/tenant.ts";
import { can, type Viewer } from "@/lib/capabilities.ts";
import { logError } from "@/lib/logger.ts";
import { AWAITING_REVIEW } from "@/modules/council/model.ts";
import type { AttentionInput } from "./rules.ts";
import {
  CALENDAR_HORIZON_DAYS,
  DEFENCE_HORIZON_DAYS,
  DOSSIER_HORIZON_DAYS,
  SITTING_HORIZON_DAYS,
  WORKSHOP_HORIZON_DAYS,
} from "./vocabulary.ts";

/**
 * The counts every attention rule is decided from.
 *
 * ── Every horizon is cast ───────────────────────────────────────────────────
 *
 * `current_date + ${DAYS}` sends the number as a bound parameter, and a bound
 * parameter arrives untyped: PostgreSQL cannot choose between `date + integer`
 * and `date + interval` and refuses the whole statement with «operator is not
 * unique». It is invisible in TypeScript and invisible in a psql transcript
 * too, because a literal `7` typed by hand parses as an integer and works. So
 * each one carries `::int`.
 *
 * ── One statement, and one round trip ───────────────────────────────────────
 *
 * This runs on every page load, because the bell is in the shell. Six separate
 * queries would be six round trips on every navigation in the application, so
 * the counts are gathered as scalar subqueries in a single `select` — each
 * independent, none joined to another, so there is no fan-out to get wrong.
 *
 * ── A refused read is not a count of nought ─────────────────────────────────
 *
 * If the statement fails, every group is reported `ready: false` rather than
 * zero. Nought and «not counted» are the same number and opposite claims, and
 * the surfaces that draw these treat them differently: an unready signal is
 * never raised on the bell and never coloured green. The alternative — letting
 * a failure render as «nothing needs you» — is the one outcome a notification
 * system must not have.
 */

/** What a failed read looks like: entitled as before, but answering nothing. */
function unanswered(viewer: Viewer): AttentionInput {
  return {
    council: {
      entitled: can(viewer, "council.view"),
      ready: false,
      pendingTotal: 0,
      oldestMeeting: null,
      oldestDays: null,
      defencesSoon: 0,
      defencesIncomplete: 0,
      sittingsSoon: 0,
    },
    students: {
      entitled: can(viewer, "students.view"),
      ready: false,
      unsupervised: 0,
      masters: 0,
    },
    workshops: { entitled: can(viewer, "workshops.view"), ready: false, withoutInstructor: 0 },
    calendar: {
      entitled: can(viewer, "calendar.view"),
      ready: false,
      upcoming: 0,
      nextTitle: null,
    },
    institution: { entitled: can(viewer, "institution.manage"), unnamed: false },
  };
}

/**
 * Multi-instance-safe attention projection.
 *
 * The legacy implementation cached the bell in a process-local `Map`, which meant three web
 * instances could legitimately show three different answers. The current architecture stores the
 * short-lived projection in PostgreSQL instead. The source query remains the
 * authority and is still used on a cache miss; projection failure never turns
 * into a false clean bill of health.
 */
const ATTENTION_TTL_MS = 30_000;
const ATTENTION_CATEGORIES = [
  "council",
  "students",
  "workshops",
  "calendar",
  "institution",
] as const;
type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number];

function groupCount(category: AttentionCategory, input: AttentionInput): number {
  switch (category) {
    case "council":
      return (
        input.council.pendingTotal +
        input.council.defencesSoon +
        input.council.defencesIncomplete +
        input.council.sittingsSoon
      );
    case "students":
      return input.students.unsupervised;
    case "workshops":
      return input.workshops.withoutInstructor;
    case "calendar":
      return input.calendar.upcoming;
    case "institution":
      return input.institution.unnamed ? 1 : 0;
  }
}

function parseProjected(
  rows: Array<{ category: string; payload: string; lastCalculatedAt: Date }>,
): AttentionInput | null {
  if (rows.length < ATTENTION_CATEGORIES.length) return null;
  const now = Date.now();
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  const result: Partial<Record<AttentionCategory, unknown>> = {};

  for (const category of ATTENTION_CATEGORIES) {
    const row = byCategory.get(category);
    if (!row || now - row.lastCalculatedAt.getTime() >= ATTENTION_TTL_MS) return null;
    try {
      result[category] = JSON.parse(row.payload);
    } catch {
      return null;
    }
  }
  return result as AttentionInput;
}

async function readAttentionProjection(viewer: Viewer): Promise<AttentionInput | null> {
  try {
    const rows = await readOnly(viewer.tenantId, (tx) =>
      tx
        .select({
          category: attentionSummary.category,
          payload: attentionSummary.payload,
          lastCalculatedAt: attentionSummary.lastCalculatedAt,
        })
        .from(attentionSummary)
        .where(and(eq(attentionSummary.userId, viewer.userId))),
    );
    return parseProjected(rows);
  } catch (cause) {
    logError("attention.projection_read_failed", cause, {
      tenantId: viewer.tenantId,
      userId: viewer.userId,
    });
    return null;
  }
}

async function persistAttentionProjection(viewer: Viewer, value: AttentionInput): Promise<void> {
  try {
    await writeTenant(viewer.tenantId, async (tx) => {
      /*
       * The session can become stale while a request is rendering (for
       * example, an administrator may suspend the account in another tab).
       * The previous implementation inserted the viewer ID directly and
       * logged a foreign-key error when that user disappeared between auth
       * and this optional cache write. Resolve and lock the target user in the
       * same statement; a missing user becomes a deliberate no-op, never a
       * projection error or a retry storm.
       */
      const input = ATTENTION_CATEGORIES.map(
        (category) =>
          sql`(${category}, ${groupCount(category, value)}::int, ${JSON.stringify(value[category])})`,
      );
      await tx.execute(sql`
        with target_user as (
          select id
            from "user"
           where tenant_id=${viewer.tenantId}
             and id=${viewer.userId}
             and suspended_at is null
           for share
        ), projection_input(category, summary_count, payload) as (
          values ${sql.join(input, sql`, `)}
        )
        insert into attention_summary(
          tenant_id,user_id,category,count,payload,last_calculated_at
        )
        select ${viewer.tenantId},target_user.id,projection_input.category,
               projection_input.summary_count,projection_input.payload,now()
          from target_user cross join projection_input
        on conflict (tenant_id,user_id,category) do update
          set count=excluded.count,
              payload=excluded.payload,
              last_calculated_at=excluded.last_calculated_at,
              updated_at=now()
      `);
    });
  } catch (cause) {
    // The live source answer is still safe to render. Projection persistence is
    // an optimization and must never make the application shell unavailable.
    logError("attention.projection_write_failed", cause, {
      tenantId: viewer.tenantId,
      userId: viewer.userId,
    });
  }
}

export async function readAttention(viewer: Viewer): Promise<AttentionInput> {
  const projected = await readAttentionProjection(viewer);
  if (projected) return projected;

  const value = await readAttentionUncached(viewer);
  await persistAttentionProjection(viewer, value);
  return value;
}

async function readAttentionUncached(viewer: Viewer): Promise<AttentionInput> {
  /* The council's own list, not a second spelling of it — see `AWAITING_REVIEW`. */
  const awaiting = sql`(${sql.join(
    AWAITING_REVIEW.map((status) => sql`${status}`),
    sql`, `,
  )})`;

  try {
    const result = await readOnly(viewer.tenantId, (tx) =>
      tx.execute(sql`
        select
          /* ── The council ────────────────────────────────────────────── */
          (select count(*) from council_decisions d
             where d.deleted_at is null
               and d.review_status in ${awaiting}
          ) as pending_total,

          (select d.meeting_number from council_decisions d
             where d.deleted_at is null
               and d.review_status in ${awaiting}
               and d.meeting_date is not null
             order by d.meeting_date asc limit 1
          ) as oldest_meeting,

          (select (current_date - min(d.meeting_date))::int from council_decisions d
             where d.deleted_at is null
               and d.review_status in ${awaiting}
          ) as oldest_days,

          /* A defence the council has cleared, happening inside the window. */
          (select count(*) from council_decisions d
             where d.deleted_at is null
               and d.defense_meeting_date between current_date
                   and current_date + ${DEFENCE_HORIZON_DAYS}::int
          ) as defences_soon,

          /*
           * The same defences, narrowed to the ones whose file is short of a
           * paper the defence cannot legally proceed without. Read over a
           * longer window than the defence itself — chasing a certificate takes
           * days, so a warning arriving with the defence arrives too late.
           */
          (select count(*) from council_decisions d
             where d.deleted_at is null
               and d.defense_meeting_date between current_date
                   and current_date + ${DOSSIER_HORIZON_DAYS}::int
               and (coalesce(d.defense_permit_form, false) = false
                 or coalesce(d.thesis_file, false) = false
                 or coalesce(d.defense_similarity_certificate, false) = false)
          ) as defences_incomplete,

          (select count(*) from council_meetings m
             where m.deleted_at is null
               and m.meeting_date between current_date
                   and current_date + ${SITTING_HORIZON_DAYS}::int
          ) as sittings_soon,

          /* ── The registers ──────────────────────────────────────────── */
          (select count(*) from students s
             where s.deleted_at is null and s.status = 'enrolled'
               and s.primary_supervisor_id is null
               and s.secondary_supervisor_id is null
               and s.third_supervisor_id is null
          ) as unsupervised,

          (select count(*) from students s
             where s.deleted_at is null and s.status = 'enrolled'
               and s.primary_supervisor_id is null
               and s.secondary_supervisor_id is null
               and s.third_supervisor_id is null
               and s.degree = 'masters'
          ) as unsupervised_masters,

          /*
           * A workshop inside its preparation window with nobody named to teach
           * it. Blocking, and closed by one edit.
           */
          (select count(*) from workshops w
             where w.deleted_at is null
               and w.workshop_date between current_date and current_date + ${WORKSHOP_HORIZON_DAYS}::int
               and not exists (select 1 from workshop_instructors i
                                where i.workshop_id = w.id and i.deleted_at is null)
          ) as workshops_without_instructor,

          /* ── The office's own diary ─────────────────────────────────── */
          (select count(*) from calendar_entries c
             where c.deleted_at is null
               and c.entry_date between current_date
                   and current_date + ${CALENDAR_HORIZON_DAYS}::int
          ) as notes_upcoming,

          (select c.title from calendar_entries c
             where c.deleted_at is null
               and c.entry_date between current_date
                   and current_date + ${CALENDAR_HORIZON_DAYS}::int
             order by c.entry_date asc, c.id asc limit 1
          ) as next_note,

          /* ── The letterhead ─────────────────────────────────────────── */
          (select count(*) from institutions i
             where coalesce(btrim(i.name), '') <> ''
          ) as institution_named
      `),
    );

    const row = result.rows[0];
    if (!row) return unanswered(viewer);

    const number = (value: unknown): number => {
      /* `count(*)` is a bigint and node-postgres hands one over as a string
         rather than narrowing a 64-bit integer. */
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const text = (value: unknown): string | null =>
      typeof value === "string" && value.trim() !== "" ? value : null;

    const counts = row as Record<string, unknown>;

    return {
      council: {
        entitled: can(viewer, "council.view"),
        ready: true,
        pendingTotal: number(counts.pending_total),
        oldestMeeting: text(counts.oldest_meeting),
        oldestDays: counts.oldest_days === null ? null : number(counts.oldest_days),
        defencesSoon: number(counts.defences_soon),
        defencesIncomplete: number(counts.defences_incomplete),
        sittingsSoon: number(counts.sittings_soon),
      },
      students: {
        entitled: can(viewer, "students.view"),
        ready: true,
        unsupervised: number(counts.unsupervised),
        masters: number(counts.unsupervised_masters),
      },
      workshops: {
        entitled: can(viewer, "workshops.view"),
        ready: true,
        withoutInstructor: number(counts.workshops_without_instructor),
      },
      calendar: {
        entitled: can(viewer, "calendar.view"),
        ready: true,
        upcoming: number(counts.notes_upcoming),
        nextTitle: text(counts.next_note),
      },
      institution: {
        entitled: can(viewer, "institution.manage"),
        unnamed: number(counts.institution_named) === 0,
      },
    };
  } catch (cause) {
    /*
     * Caught on purpose, reported as «not counted» — and logged.
     *
     * This runs in the shell on every page, so a failure here must not take
     * down the register the reader actually asked for, and it must not read as
     * a clean bill of health either; `unanswered` is what says so on screen.
     *
     * But a `catch` with nothing in it is its own defect: the symptom is a
     * column of dashes that looks like a design decision, and there is nothing
     * anywhere to say what broke. The operator gets the dashes; the log gets
     * the reason.
     */
    logError("attention.counts_read_failed", cause, { tenantId: viewer.tenantId });
    return unanswered(viewer);
  }
}
