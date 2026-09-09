import { sql } from "drizzle-orm";
import { readOnly } from "@/db/tenant.ts";
import {
  PROPOSAL_DECISION_CATEGORIES,
  sqlInList,
  VALID_DECISION_STATUSES,
} from "@/lib/council-stage-policy.ts";

/**
 * How much examining each academic has actually done, counted from the minutes.
 *
 * ── Why it is counted rather than stored ────────────────────────────────────
 *
 * Nothing writes this figure down. Every examining appointment the council makes
 * is recorded in a decision, so the minutes already hold the answer — and a
 * stored tally would be a second copy that nothing updates when a sitting is
 * corrected.
 *
 * ── The rules are the office's ──────────────────────────────────────────────
 *
 *  - only **proposal-stage** decisions count. A final-defence panel is largely
 *    the same people re-reading the same thesis, and counting both would double
 *    every workload;
 *  - only decisions the council **approved**. A panel it declined to appoint did
 *    no work;
 *  - one decision counts **once per examiner** however many seats they appear
 *    in, and a case that returns to a later sitting at the same stage counts
 *    once — the key is (student, sitting, stage);
 *  - the graduate-studies representative is tallied **separately**. They attend
 *    to witness procedure, not to mark the work, so the number belongs beside
 *    the examining counts rather than inside them.
 *
 * ── Names, not identifiers ──────────────────────────────────────────────────
 *
 * The board is free text, deliberately — the council appoints guest examiners
 * from other universities who are in no directory. So the tally is by *name*,
 * folded through `app.fold_person`, which also strips the honorific a minute
 * carries and the directory does not: «دکتر محمدرضا اکبری» and «محمدرضا اکبری»
 * are one academic, and without that half of everybody's work is reported under
 * a name the directory cannot place.
 *
 * A name that matches the directory is reported as staff; one that does not is
 * reported as an external examiner under the name the council minuted, which is
 * the only name they have.
 *
 * Names are matched only after deterministic normalization. Substring or fuzzy
 * matching is deliberately avoided because two academics who share a surname
 * must never be merged in an examining-workload report.
 */

/** The stages whose panels are counted. A defence re-reads the same work. */
const PROPOSAL_CATEGORIES = [...PROPOSAL_DECISION_CATEGORIES];

/** The outcomes that mean the panel was actually appointed. */
const APPOINTED = [...VALID_DECISION_STATUSES];

/** A Jalali-year restriction on the decision's sitting date. */
function reviewerYearFilter(year: number | null) {
  return year === null ? sql.empty() : sql`and app.jalali_year(d.meeting_date) = ${year}`;
}

export interface ReviewerRow {
  /** The folded name, which is the identity the tally is grouped by. */
  key: string;
  /** The name as the council minuted it — the first spelling seen. */
  name: string;
  /** Set when the name matches somebody in the professor directory. */
  professorId: string | null;
  academicRank: string | null;
  university: string | null;
  faculty: string | null;
  department: string | null;
  specialization: string | null;
  /**
   * Distinct (student, sitting, stage) cases they examined.
   *
   * The sum of the three degree figures below, and drawn as the headline
   * rather than as one of them. The office reads this table across a row and
   * has to know which numbers add up: `masters + generalDoctorate +
   * specializedDoctorate === reviews`, while `representations` and `cases` sit
   * outside that sum. The register bands the columns to say so.
   */
  reviews: number;
  masters: number;
  /** «دکتری حرفه‌ای» — the D.V.M, which is a general doctorate. */
  generalDoctorate: number;
  /** «دکتری تخصصی» and «دستیاری تخصصی». */
  specializedDoctorate: number;
  /**
   * Examinations the three degree figures do not cover.
   *
   * A case whose degree was never recorded, or one at a degree this office
   * examines no thesis for — «کارشناسی» and «کاردانی» write none. Not drawn on
   * the register, but carried so the three can be *checked* to account for the
   * headline: without it the breakdown quietly falls short and the column bands
   * claim something untrue about the row.
   */
  otherDegree: number;
  /** Cases they sat on as the graduate-studies representative. */
  representations: number;
  /**
   * Distinct students, however many stages of their work this person examined.
   *
   * Outside the sum: a case examined at proposal and again at defence is two
   * examinations and one case, and an office asking «how many people has this
   * examiner seen» wants the second number.
   */
  cases: number;
  /** The most recent sitting they examined at, or null. */
  lastReviewDate: string | null;
}

/**
 * A list of constants as an SQL `IN` list, one bound parameter each.
 *
 * `= any($1)` with a JavaScript array does not work: Drizzle binds it as a
 * scalar and PostgreSQL answers `42809` — the ANY operator wants a real array on
 * its right. Interpolating the values into the string would work and is how
 * injections are written, so each is bound and joined instead.
 */
/**
 * Where an examining seat comes from, and which ones count.
 *
 * Written once and used by both readers below. The tally and the list of cases
 * behind it *must* select from the same rows: an examiner shown «۵» who opens
 * the working and finds four does not conclude that the list is wrong — they
 * conclude the figure is, and this screen exists to be argued with. Two copies
 * of these five seats and three conditions is exactly how that drift happens,
 * and `reviewers.integration.test.ts` asserts the two agree for every examiner
 * in the register.
 */
const PANEL_SOURCE = sql`
  from council_decisions d
  cross join lateral (values
    (d.reviewer1, false),
    (d.reviewer2, false),
    (d.reviewer3, false),
    (d.reviewer4_invited, false),
    (d.graduate_studies_representative, true)
  ) as seat(name, is_representative)
  where d.deleted_at is null
    and d.report_category in (${sqlInList(PROPOSAL_CATEGORIES)})
    and d.review_status in (${sqlInList(APPOINTED)})
    and nullif(btrim(coalesce(seat.name, '')), '') is not null`;

export async function readReviewerCounts(
  tenantId: string,
  year: number | null = null,
): Promise<ReviewerRow[]> {
  const rows = await readOnly(tenantId, async (tx) => {
    const result = await tx.execute(sql`
      with panels as (
        select
          d.id,
          /*
           * The case, not the row. A proposal that comes back to a later
           * sitting at the same stage is the same piece of work — so the key is
           * the student, the sitting and the stage, and a decision entered
           * twice for one sitting counts once.
           */
          coalesce(d.student_id::text, coalesce(d.student_number, d.id::text)) as student_key,
          d.meeting_number,
          d.report_category,
          d.meeting_date,
          d.education_level,
          seat.name,
          seat.is_representative
        ${PANEL_SOURCE}
        ${reviewerYearFilter(year)}
      ),
      counted as (
        select
          app.fold_person(name) as folded,
          -- The first spelling seen, so the report reads the way the minute did.
          min(name) as minuted,
          count(distinct case when not is_representative
                then student_key || '|' || meeting_number || '|' || report_category end) as reviews,
          count(distinct case when is_representative
                then student_key || '|' || meeting_number || '|' || report_category end) as representations,

          /*
           * The three degree figures, which partition the headline exactly. A
           * record whose level is unrecorded falls into none of them, so they
           * are counted from the same distinct key and the office can see the
           * three add up to the headline — or, where they do not, that some
           * case carries no degree.
           */
          count(distinct case when not is_representative and education_level = 'master'
                then student_key || '|' || meeting_number || '|' || report_category end) as masters,
          count(distinct case when not is_representative
                and education_level = 'professional_doctorate'
                then student_key || '|' || meeting_number || '|' || report_category end)
                as general_doctorate,
          count(distinct case when not is_representative
                and education_level in ('phd', 'specialty')
                then student_key || '|' || meeting_number || '|' || report_category end)
                as specialized_doctorate,

          /*
           * Everything the three columns do not cover.
           *
           * Two kinds of row land here, and both are real on this registry: a
           * case whose degree was never recorded, and one at a degree this
           * office does not examine a thesis for — «کارشناسی» and «کاردانی»
           * write none, so they are deliberately outside the three.
           *
           * Not a column on the register: the reference prints three degrees
           * and so does this. It is counted because without it the three
           * quietly fail to add up to the headline beside them and the column
           * bands become a false claim about the row. The integration guard
           * asserts the four account for every examination.
           */
          count(distinct case when not is_representative
                and coalesce(education_level, '')
                    not in ('master', 'professional_doctorate', 'phd', 'specialty')
                then student_key || '|' || meeting_number || '|' || report_category end)
                as other_degree,

          /* The student, not the examination: a case examined twice is two
             examinations and one case. */
          count(distinct case when not is_representative then student_key end) as cases,
          max(meeting_date) filter (where not is_representative) as last_review_date
        from panels
        group by app.fold_person(name)
      )
      select
        c.folded          as key,
        c.minuted         as name,
        c.reviews         as reviews,
        c.masters         as masters,
        c.general_doctorate as general_doctorate,
        c.specialized_doctorate as specialized_doctorate,
        c.representations as representations,
        c.cases           as cases,
        c.other_degree    as other_degree,
        c.last_review_date as last_review_date,
        p.id              as professor_id,
        p.academic_rank   as academic_rank,
        p.university      as university,
        p.faculty         as faculty,
        p.department      as department,
        p.specialization  as specialization
      from counted c
      /*
       * Matched on the folded form, exactly. A directory name and a minuted one
       * that differ only in which yeh the keyboard produced are the same person;
       * two academics who share a surname are not, and a fuzzy rule cannot tell
       * those cases apart.
       */
      left join professors p
        on p.deleted_at is null
       and app.fold_person(btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')))
           = c.folded
      order by c.reviews desc, c.representations desc, c.minuted
    `);

    return result.rows as Record<string, unknown>[];
  });

  return rows.map((row) => ({
    key: String(row.key),
    name: String(row.name ?? ""),
    professorId: row.professor_id === null ? null : String(row.professor_id),
    academicRank: row.academic_rank === null ? null : String(row.academic_rank),
    university: row.university === null ? null : String(row.university),
    faculty: row.faculty === null ? null : String(row.faculty),
    department: row.department === null ? null : String(row.department),
    specialization: row.specialization === null ? null : String(row.specialization),
    /* `count(*)` is a bigint and node-postgres hands one over as a string, so
       every figure is narrowed here rather than at each reader. */
    reviews: Number(row.reviews ?? 0),
    masters: Number(row.masters ?? 0),
    generalDoctorate: Number(row.general_doctorate ?? 0),
    specializedDoctorate: Number(row.specialized_doctorate ?? 0),
    otherDegree: Number(row.other_degree ?? 0),
    representations: Number(row.representations ?? 0),
    cases: Number(row.cases ?? 0),
    lastReviewDate: row.last_review_date === null ? null : String(row.last_review_date),
  }));
}

/** One examination, as the working behind an examiner's figure lists it. */
export interface ReviewerCase {
  /** The decision this examination was minuted on, so the case can be opened. */
  id: string;
  studentName: string | null;
  studentNumber: string | null;
  thesisTitle: string | null;
  educationLevel: string | null;
  meetingNumber: string | null;
  meetingDate: string | null;
  reportCategory: string | null;
  /**
   * Sat as the graduate-studies representative rather than as an examiner.
   *
   * Carried because the register reports the two figures separately, and a list
   * that merged them would come to a total the row never claims. Shown on the
   * case rather than filtered out: «why is this one not in my five» has an
   * answer, and it is this flag.
   */
  isRepresentative: boolean;
}

/**
 * The cases behind one examiner's figure.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 *
 * A count nobody can open is a count nobody argues with, and this office does
 * argue with these: a colleague who remembers examining four proposals and is
 * shown three wants the three. What settles it is a list read beside the table
 * it came from — one that can be sent to the person disputing it, and printed.
 *
 * ── Why it is matched on the folded name ────────────────────────────────────
 *
 * `app.fold_person` is what the tally groups by, so it is what this must select
 * by. An exact `=` on the minuted spelling was the defect the application
 * required by the reviewer tally: it merges «دکتر علی رضایی»
 * and «علی رضایی» into one figure, and a verbatim comparison fetched half the
 * cases behind it — settling the argument the wrong way, against the office.
 *
 * ── Why the rows are made distinct here ─────────────────────────────────────
 *
 * The tally counts `distinct (student, sitting, stage)`, because a case that
 * returns to a later sitting at the same stage is one piece of work and a
 * decision entered twice for one sitting is one appointment. This lists the
 * same keys, so the length of what comes back is the figure — which is the
 * property `reviewers.integration.test.ts` pins.
 */
export async function reviewerCases(tenantId: string, name: string): Promise<ReviewerCase[]> {
  const wanted = name.trim();
  /* Board-seat fields are capped at 300 characters. Anything longer cannot be
     a stored examiner name and must not be fed to the database text fold. */
  if (!wanted || wanted.length > 300) return [];

  const rows = await readOnly(tenantId, async (tx) => {
    const result = await tx.execute(sql`
      with panels as (
        select
          d.id,
          coalesce(d.student_id::text, coalesce(d.student_number, d.id::text)) as student_key,
          d.student_name,
          d.student_number,
          d.thesis_title,
          d.education_level,
          d.meeting_number,
          d.meeting_date,
          d.report_category,
          seat.name,
          seat.is_representative
        ${PANEL_SOURCE}
          and app.fold_person(seat.name) = app.fold_person(${wanted})
      )
      /*
       * One row per (student, sitting, stage) — the tally's own key.
       *
       * "distinct on" needs its leading expressions to open the "order by", so
       * the reading order is applied outside. Where one case has both an
       * examining seat and the representative's, is_representative ascending
       * keeps the examining one: that is the seat the headline counted.
       */
      select * from (
        select distinct on (student_key, meeting_number, report_category)
          id, student_name, student_number, thesis_title, education_level,
          meeting_number, meeting_date, report_category, is_representative
        from panels
        order by student_key, meeting_number, report_category, is_representative
      ) one
      -- Newest sitting first: a working is read from the present backwards.
      order by meeting_date desc nulls last, meeting_number desc, student_name
    `);

    return result.rows as Record<string, unknown>[];
  });

  return rows.map((row) => ({
    id: String(row.id),
    studentName: row.student_name === null ? null : String(row.student_name),
    studentNumber: row.student_number === null ? null : String(row.student_number),
    thesisTitle: row.thesis_title === null ? null : String(row.thesis_title),
    educationLevel: row.education_level === null ? null : String(row.education_level),
    meetingNumber: row.meeting_number === null ? null : String(row.meeting_number),
    meetingDate: row.meeting_date === null ? null : String(row.meeting_date),
    reportCategory: row.report_category === null ? null : String(row.report_category),
    isRepresentative: row.is_representative === true,
  }));
}
