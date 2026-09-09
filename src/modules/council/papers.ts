import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  councilAppointments,
  councilDecisions,
  councilMeetings,
  councilRulings,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import {
  noteLines,
  orderRulings,
  type SittingAppointment,
  type SittingDecision,
  type SittingRuling,
  type SittingSections,
  type SittingTotals,
  sittingTotals,
  splitDecisions,
} from "./sittings.ts";

/**
 * What the two document pages read off a sitting.
 *
 * ── Why this reads by *number* and not by id ────────────────────────────────
 *
 * A decision is routinely filed before the sitting record exists — the schema
 * says so, and it is the ordinary order of events in the office: the minute of
 * ۶۷۹ is typed up from the papers, and somebody creates the sitting afterwards.
 * Those rows carry `meeting_number` and a null `meeting_id`.
 *
 * Joining on `meeting_id` alone therefore prints a *short* minute — the sitting
 * looks like it resolved less than it did, and nothing on the page says so. On
 * this registry's own data that is three of fifteen decisions. So the join is
 * «linked to this sitting, or filed against its number», which is what the
 * archive means by "belongs to sitting ۶۷۹".
 */

/** A sitting as the picker lists it, with how much business it carries. */
export interface SittingOption {
  id: string;
  meetingNumber: string;
  meetingDate: string | null;
  meetingTime?: string | null;
  meetingDay?: string | null;
  meetingLocation?: string | null;
  researchDeputy?: string | null;
  items: number;
}

/**
 * Every sitting on record, newest first.
 *
 * `items` counts the three registers the same way the sittings register does,
 * and it has to: the picker offers «جلسه ۶۸۰ (۵ مورد)» and the register badges
 * the same sitting «۵ مورد», so a second spelling of the count is two answers
 * to one question.
 *
 * ── The outer reference is qualified by hand ────────────────────────────────
 *
 * Drizzle renders a column embedded in a raw `sql` template **unqualified**.
 * Written as `d.meeting_number = ${councilMeetings.meetingNumber}` this came
 * out as `d.meeting_number = "meeting_number"`, and inside a subquery selecting
 * from `council_decisions` that bare name resolves to *that* table's column —
 * so the predicate was `d.meeting_number = d.meeting_number`, true of every
 * row, and every sitting reported the whole register: «۲۲ مورد» against the
 * register's «۵».
 *
 * It is valid SQL and PostgreSQL raises nothing. The only symptom is two
 * screens disagreeing, which is how it was found. The sittings register carries
 * the same warning for the same reason.
 *
 * `count(*)` is `bigint` and node-postgres hands a 64-bit integer over as a
 * string rather than narrowing it, so the sum is mapped to a number here —
 * added together untouched, `items` would be string concatenation.
 */
export async function readSittings(tenantId: string): Promise<SittingOption[]> {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: councilMeetings.id,
        meetingNumber: councilMeetings.meetingNumber,
        meetingDate: councilMeetings.meetingDate,
        meetingTime: councilMeetings.meetingTime,
        meetingDay: councilMeetings.meetingDay,
        meetingLocation: councilMeetings.meetingLocation,
        researchDeputy: councilMeetings.researchDeputy,
        items: sql<number>`(
          (select count(*) from council_decisions d
             where d.deleted_at is null
               and (d.meeting_id = council_meetings.id
                    or d.meeting_number = council_meetings.meeting_number))
        + (select count(*) from council_rulings r
             where r.deleted_at is null
               and (r.meeting_id = council_meetings.id
                    or r.meeting_number = council_meetings.meeting_number))
        + (select count(*) from council_appointments a
             where a.deleted_at is null
               and (a.meeting_id = council_meetings.id
                    or a.meeting_number = council_meetings.meeting_number))
        )`.mapWith(Number),
      })
      .from(councilMeetings)
      .where(isNull(councilMeetings.deletedAt))
      .orderBy(desc(councilMeetings.meetingDate), desc(councilMeetings.meetingNumber))
      .limit(500),
  );
}

export interface SittingMeeting {
  id: string;
  meetingNumber: string;
  meetingDate: string | null;
  meetingTime: string | null;
  meetingDay: string | null;
  meetingLocation: string | null;
  researchDeputy: string | null;
  participants: string[] | null;
  absentees: string[] | null;
  substitutions: Record<string, string> | null;
  notes: string | null;
}

export interface SittingPapers {
  meeting: SittingMeeting;
  sections: SittingSections;
  rulings: SittingRuling[];
  selections: SittingAppointment[];
  notes: string[];
  totals: SittingTotals;
  /** Whether the sitting resolved anything at all. */
  anything: boolean;
}

/**
 * One sitting's papers, grouped as the documents print them.
 *
 * Returns `null` when there is no such sitting, which the pages turn into a
 * 404 rather than an empty document: a blank minute headed «جلسه ۹۹۹» is a
 * council instrument for a sitting that never happened.
 */
export async function readSittingPapers(
  tenantId: string,
  meetingNumber: string,
): Promise<SittingPapers | null> {
  return readOnly(tenantId, async (tx) => {
    const [meeting] = await tx
      .select({
        id: councilMeetings.id,
        meetingNumber: councilMeetings.meetingNumber,
        meetingDate: councilMeetings.meetingDate,
        meetingTime: councilMeetings.meetingTime,
        meetingDay: councilMeetings.meetingDay,
        meetingLocation: councilMeetings.meetingLocation,
        researchDeputy: councilMeetings.researchDeputy,
        participants: councilMeetings.participants,
        absentees: councilMeetings.absentees,
        substitutions: councilMeetings.substitutions,
        notes: councilMeetings.notes,
      })
      .from(councilMeetings)
      .where(
        and(eq(councilMeetings.meetingNumber, meetingNumber), isNull(councilMeetings.deletedAt)),
      )
      .limit(1);

    if (!meeting) return null;

    /* The sitting's business, however it was filed — see the note above. */
    const filedHere = (linked: AnyPgColumn, numbered: AnyPgColumn) =>
      or(eq(linked, meeting.id), eq(numbered, meeting.meetingNumber));

    const decisions = await tx
      .select({
        id: councilDecisions.id,
        studentNumber: councilDecisions.studentNumber,
        studentName: councilDecisions.studentName,
        educationLevel: councilDecisions.educationLevel,
        fieldOfStudy: councilDecisions.fieldOfStudy,
        thesisTitle: councilDecisions.thesisTitle,
        reportCategory: councilDecisions.reportCategory,
        reviewStatus: councilDecisions.reviewStatus,
        councilNotes: councilDecisions.councilNotes,
        proposalDefenseDate: councilDecisions.proposalDefenseDate,
        achievements: councilDecisions.achievements,
        bioethicsCode: councilDecisions.bioethicsCode,
        finalProposalFile: councilDecisions.finalProposalFile,
        proposalDefensePermitForm: councilDecisions.proposalDefensePermitForm,
        researchBackground: councilDecisions.researchBackground,
        similarityCertificate: councilDecisions.similarityCertificate,
        labSafetyCertificate: councilDecisions.labSafetyCertificate,
        bioethicsCertificate: councilDecisions.bioethicsCertificate,
        languageCertificate: councilDecisions.languageCertificate,
        thesisFile: councilDecisions.thesisFile,
        defensePermitForm: councilDecisions.defensePermitForm,
        defenseSimilarityCertificate: councilDecisions.defenseSimilarityCertificate,
        defenseLanguageCertificate: councilDecisions.defenseLanguageCertificate,
        researchPerformanceReports: councilDecisions.researchPerformanceReports,
        primarySupervisor: councilDecisions.primarySupervisor,
        secondarySupervisor: councilDecisions.secondarySupervisor,
        thirdSupervisor: councilDecisions.thirdSupervisor,
        firstAdvisor: councilDecisions.firstAdvisor,
        secondAdvisor: councilDecisions.secondAdvisor,
        thirdAdvisor: councilDecisions.thirdAdvisor,
        reviewer1: councilDecisions.reviewer1,
        reviewer2: councilDecisions.reviewer2,
        reviewer3: councilDecisions.reviewer3,
        reviewer4Invited: councilDecisions.reviewer4Invited,
        graduateStudiesRepresentative: councilDecisions.graduateStudiesRepresentative,
      })
      .from(councilDecisions)
      .where(
        and(
          filedHere(councilDecisions.meetingId, councilDecisions.meetingNumber),
          isNull(councilDecisions.deletedAt),
        ),
      )
      /*
       * Ordered by the student number the sitting was minuted against, not by
       * name: the office reads the checklist beside a pile of files and the
       * files are in number order. Folded so that a Persian-digit number and an
       * ASCII one interleave the way a human reads them, and by id last so the
       * order cannot change between the two documents.
       */
      .orderBy(asc(councilDecisions.studentNumber), asc(councilDecisions.id));

    const rulings = await tx
      .select({
        id: councilRulings.id,
        reportCategory: councilRulings.reportCategory,
        reviewStatus: councilRulings.reviewStatus,
        decisionText: councilRulings.decisionText,
        decisionDescription: councilRulings.decisionDescription,
      })
      .from(councilRulings)
      .where(
        and(
          filedHere(councilRulings.meetingId, councilRulings.meetingNumber),
          isNull(councilRulings.deletedAt),
        ),
      )
      .orderBy(asc(councilRulings.createdAt), asc(councilRulings.id));

    /*
     * Section (د) reads the *live* directory for the three supervisors, not a
     * copy on the appointment: the appointment stores ids, and a professor who
     * was renamed since the sitting should be minuted under the name the
     * directory holds now. The name the minute was signed with is preserved on
     * the decisions, which are the historical documents; an appointment is a
     * pointer.
     */
    const supervisorName = (column: AnyPgColumn) =>
      sql<string | null>`(select p.first_name || ' ' || p.last_name from professors p
                           where p.id = ${column} and p.deleted_at is null)`;

    const appointments = await tx
      .select({
        id: councilAppointments.id,
        studentNumber: councilAppointments.studentNumber,
        studentName: councilAppointments.studentName,
        educationLevel: councilAppointments.educationLevel,
        fieldOfStudy: councilAppointments.fieldOfStudy,
        first: supervisorName(councilAppointments.primarySupervisorId),
        second: supervisorName(councilAppointments.secondarySupervisorId),
        third: supervisorName(councilAppointments.thirdSupervisorId),
      })
      .from(councilAppointments)
      .where(
        and(
          filedHere(councilAppointments.meetingId, councilAppointments.meetingNumber),
          isNull(councilAppointments.deletedAt),
        ),
      )
      .orderBy(asc(councilAppointments.studentName), asc(councilAppointments.id));

    const sections = splitDecisions(decisions as SittingDecision[]);
    const ordered = orderRulings(rulings);
    const notes = noteLines(meeting.notes);
    const selections: SittingAppointment[] = appointments.map((row) => ({
      id: row.id,
      studentNumber: row.studentNumber,
      studentName: row.studentName,
      educationLevel: row.educationLevel,
      fieldOfStudy: row.fieldOfStudy,
      supervisors: [row.first, row.second, row.third].filter(
        (name): name is string => typeof name === "string" && name.trim() !== "",
      ),
    }));

    return {
      meeting,
      sections,
      rulings: ordered,
      selections,
      notes,
      totals: sittingTotals(sections, ordered, notes, selections),
      anything:
        sections.proposals.length +
          sections.defences.length +
          sections.unfiled.length +
          ordered.length +
          selections.length +
          notes.length >
        0,
    };
  });
}
