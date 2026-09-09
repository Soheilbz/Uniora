import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { councilDecisions, institutions, tenants } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";

/**
 * The case a form is printed from, and who its panel are.
 *
 * Two reads, because they answer two questions. The decision is the record; the
 * register is what turns the names inside it into the three things every ruled
 * table asks about a panel member — the name under its honorific, the academic
 * rank, and the faculty served. A form that could answer only the first prints
 * two empty columns on every panel on every sheet, which on a signed instrument
 * is worse than a wording difference: the form looks abandoned half-completed,
 * and an examiner's rank is part of what their signature attests.
 */

/**
 * How many cases a search may put on screen.
 *
 * NOT A PAGE SIZE — A SIGNAL THAT THE SEARCH IS TOO BROAD.
 *
 * A person holds one to four council decisions, so nothing about a *person* can
 * overflow this. What can overflow is a search for a common word, and past six
 * a result set has stopped being an answer and become a register. At that point
 * the screen says so and asks for another word rather than drawing a list
 * nobody can use.
 *
 * One more row than this is read, so "there are more" can be said without a
 * second count query.
 */
export const MAX_CASES = 6;

/** Every column of a decision a form may print a value from. */
const SHEET_COLUMNS = sql`
  id, meeting_number, meeting_date, meeting_time, meeting_day, meeting_location,
  student_number, student_name, education_level, field_of_study,
  thesis_title, thesis_code, research_type, report_category,
  primary_supervisor, secondary_supervisor, third_supervisor,
  first_advisor, second_advisor, third_advisor,
  reviewer1, reviewer2, reviewer3, reviewer4_invited,
  graduate_studies_representative, faculty_dean, department_council,
  education_office, educational_cultural_deputy, research_deputy,
  department_head, group_manager,
  defense_meeting_date, defense_meeting_time, defense_meeting_day,
  defense_meeting_location, proposal_defense_date, council_notes`;

export interface SheetCase {
  id: string;
  studentName: string | null;
  thesisTitle: string | null;
  reportCategory: string | null;
  /*
   * The sitting number as text.
   *
   * It is a `bigint` on the record, and the driver hands a bigint back as a
   * string because it does not fit a JavaScript number — which is right, and is
   * why nothing here converts it. Nobody does arithmetic on a sitting number;
   * it is an identifier, printed as it is filed.
   */
  meetingNumber: string | null;
  meetingDate: string | null;
}

/**
 * The cases a search turns up, newest sitting first.
 *
 * Name, student number and thesis title, because those are the three things
 * somebody at the counter has in front of them. Folded on both sides, so
 * «محمدی» finds «محمّدی» — the same rule the registers search by.
 */
export async function findCases(
  tenantId: string,
  search: string,
): Promise<{ cases: SheetCase[]; overflowing: boolean }> {
  const term = search.trim().slice(0, MAX_SEARCH_LENGTH);
  if (term === "") return { cases: [], overflowing: false };

  const words = term.split(/\s+/).filter(Boolean).slice(0, 6);

  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilDecisions.id,
        studentName: councilDecisions.studentName,
        thesisTitle: councilDecisions.thesisTitle,
        reportCategory: councilDecisions.reportCategory,
        meetingNumber: councilDecisions.meetingNumber,
        meetingDate: councilDecisions.meetingDate,
      })
      .from(councilDecisions)
      .where(
        and(
          isNull(councilDecisions.deletedAt),
          /* The indexed haystack, not a fold per row — see `decisionConditions`
             in the council module and the schema note on `search_text`. */
          ...words.map(
            (word) => sql`${councilDecisions.searchText} LIKE '%' || app.fold_text(${word}) || '%'`,
          ),
        ),
      )
      .orderBy(desc(councilDecisions.meetingDate), desc(councilDecisions.id))
      .limit(MAX_CASES + 1),
  );

  return { cases: rows.slice(0, MAX_CASES), overflowing: rows.length > MAX_CASES };
}

/** Whether a search that found no case at least names somebody on file. */
export async function studentOnFile(tenantId: string, search: string): Promise<boolean> {
  const term = search.trim().slice(0, MAX_SEARCH_LENGTH);
  if (term === "") return false;

  const [row] = await readOnly(tenantId, (tx) =>
    tx.execute(sql`
      select 1 as found from students
      where deleted_at is null
        and (app.fold_person(first_name || ' ' || last_name)
               like '%' || app.fold_person(${term}) || '%'
             or student_number = ${term})
      limit 1`),
  ).then((result) => result.rows as { found: number }[]);

  return row !== undefined;
}

/**
 * One case, as a bag of columns.
 *
 * A plain record rather than a typed row, because that is what the forms read:
 * a block names a column and the renderer asks for it. Typing thirty-eight
 * columns here would buy nothing — the definitions name them as strings, which
 * is the only way a form can be described as data — and the guard that matters
 * is elsewhere: a field key naming no column is caught by the test that walks
 * every form against the table's real columns.
 */
export async function readCase(
  tenantId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const result = await readOnly(tenantId, (tx) =>
    tx.execute(sql`
      select ${SHEET_COLUMNS} from council_decisions
      where id = ${id} and deleted_at is null limit 1`),
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * The three things a ruled table asks about somebody on the panel.
 *
 * Keyed by the name the *minute* spells, not by its folded form. The fold is
 * the database's — `app.fold_person`, the same function the examining tally
 * matches on — and re-implementing it in TypeScript so a caller could look a
 * person up would be two spellings of one rule, drifting apart the first time
 * either is corrected. The query is given the names and hands them back.
 */
export interface PanelPerson {
  /** The academic rank in the register's own words, or "" if unresolved. */
  rank: string;
  /** «دانشکده / گروه» from the register, or "" if unresolved. */
  affiliation: string;
}

export type PanelRegister = Map<string, PanelPerson>;

/**
 * The register, ready to answer for the names this decision carries.
 *
 * Matched on the folded person-name, which is the same function the examining
 * tally uses — the minutes write «دکتر محمدی» and the directory holds
 * «محمدی», and a comparison that could not see past the honorific would report
 * the whole faculty as guests.
 *
 * ── Why a name matching two professors resolves to neither ─────────────────
 *
 * `having count(*) = 1`. A folded name that two people in the directory share
 * is not evidence about which of them sat on the panel, and guessing puts a
 * wrong person's rank and faculty on a signed sheet where nobody can see the
 * guess was made. The form rules a blank instead, which is what it does for a
 * guest examiner from another university and is a thing the office knows how to
 * complete in ink.
 */
export async function readPanelRegister(
  tenantId: string,
  names: readonly string[],
): Promise<PanelRegister> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const result = await readOnly(tenantId, (tx) =>
    tx.execute(sql`
      with wanted as (
        select name, app.fold_person(name) as key
        from unnest(array[${sql.join(
          wanted.map((name) => sql`${name}`),
          sql`, `,
        )}]::text[]) as name
      )
      select
        w.name,
        max(coalesce(l.label, p.academic_rank, '')) as rank,
        max(
          array_to_string(
            array_remove(
              array[
                nullif(btrim(coalesce(p.faculty, '')), ''),
                nullif(btrim(coalesce(p.department, '')), '')
              ],
              null
            ),
            ' / '
          )
        ) as affiliation
      from wanted w
      join professors p
        on p.deleted_at is null
       and app.fold_person(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) = w.key
      left join lookups l on l.set = 'academic_ranks' and l.value = p.academic_rank
      where w.key <> ''
      group by w.name
      having count(*) = 1`),
  );

  const register: PanelRegister = new Map();
  for (const row of result.rows as { name: string; rank: string; affiliation: string }[]) {
    register.set(row.name, { rank: row.rank ?? "", affiliation: row.affiliation ?? "" });
  }
  return register;
}

/**
 * The institution named at the head of the sheet.
 *
 * `named` is false when nothing has been entered, and then nothing is printed
 * in the letterhead and the paragraphs that would name the university rule a
 * blank instead. That matters most on the originality declaration, whose third
 * undertaking assigns the intellectual property in the work: a rights
 * assignment naming no party is a defect a reader can see, and a rights
 * assignment naming a *fallback word* is a defect nobody can.
 */
export interface Letterhead {
  name: string;
  faculty: string;
  /** The crest as a data URI, or "" where none has been uploaded. */
  crest: string;
  named: boolean;
  readyForOfficialPrint: boolean;
}

export async function readLetterhead(tenantId: string): Promise<Letterhead> {
  const [profile] = await readOnly(tenantId, (tx) =>
    tx
      .select({
        name: institutions.name,
        faculty: institutions.faculty,
        crest: institutions.crest,
      })
      .from(institutions)
      .where(eq(institutions.tenantId, tenantId))
      .limit(1),
  );

  const name = (profile?.name ?? "").trim();

  /*
   * The tenant's name is the fallback, and only for the first line.
   *
   * An installation that has never opened the institution profile still has a
   * name on file — the one it was provisioned under — and printing nothing when
   * something true is available would be its own kind of wrong. What is *not*
   * done is inventing a faculty or a crest: those have exactly one source, and
   * a blank is the honest rendering of an empty one.
   */
  if (name !== "") {
    return {
      name,
      faculty: (profile?.faculty ?? "").trim(),
      crest: profile?.crest ?? "",
      named: true,
      readyForOfficialPrint: name !== "" && (profile?.faculty ?? "").trim() !== "",
    };
  }

  const [tenant] = await readOnly(tenantId, (tx) =>
    tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
  );
  const provisioned = (tenant?.name ?? "").trim();

  return {
    name: provisioned,
    faculty: "",
    crest: "",
    named: provisioned !== "",
    readyForOfficialPrint: false,
  };
}

/** Every case, for the guard that walks a form against real records. */
export async function anyCase(tenantId: string): Promise<Record<string, unknown> | null> {
  const result = await readOnly(tenantId, (tx) =>
    tx.execute(sql`
      select ${SHEET_COLUMNS} from council_decisions
      where deleted_at is null order by meeting_date desc limit 1`),
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}
