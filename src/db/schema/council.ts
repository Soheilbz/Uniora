import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { professors, students } from "./registry.ts";

/* ── The council ──────────────────────────────────────────────────────────── */

/**
 * A sitting of the research council.
 *
 * The thing every decision, ruling and appointment is filed *against*. It exists
 * as its own row rather than being implied by the decisions that mention it,
 * because a sitting has facts of its own — who attended, who did not, who stood
 * in for whom — and because a council can meet, adjourn without deciding
 * anything, and still have to have met.
 */
export const councilMeetings = pgTable(
  "council_meetings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /*
     * Text, and that is the archive's decision rather than a modelling slip:
     * sittings are minuted as «۶۷۹» and occasionally «۶۷۹ (فوق‌العاده)». An
     * integer column would have to reject the second, and the second is a real
     * sitting with real decisions in it.
     */
    meetingNumber: text("meeting_number").notNull(),
    meetingDate: date("meeting_date"),
    /**
     * The hour, as text.
     *
     * `time` would be the obvious column and is the wrong one: the archive holds
     * sittings minuted as «۱۰ صبح» and «۱۰:۳۰ الی ۱۲», and a `time` column
     * cannot hold either without inventing precision the minute did not have.
     */
    meetingTime: text("meeting_time"),
    /** The weekday, as the office writes it — «یکشنبه». */
    meetingDay: text("meeting_day"),
    meetingLocation: text("meeting_location"),
    researchDeputy: text("research_deputy"),

    /*
     * Attendance, as ordered lists of names.
     *
     * `jsonb` arrays rather than a join table, because the *order* is part of
     * the record — the minute prints the names in the order the office put them
     * in — and because a great many attendees are not professors at all: the
     * education office's representative, a guest from another faculty, a
     * registrar. A join table would have to invent a person row for each of
     * them.
     *
     * `personRefs` is the bridge for those who *are* in the directory: a map
     * from the written name to a professor id, so a renamed professor stays
     * linked to the sittings they attended while the minute keeps the spelling
     * it was signed with.
     */
    participants: jsonb("participants").$type<string[]>(),
    absentees: jsonb("absentees").$type<string[]>(),
    /** Who stood in for whom: absent name → substitute name. */
    substitutions: jsonb("substitutions").$type<Record<string, string>>(),
    personRefs: jsonb("person_refs").$type<Record<string, string>>(),

    notes: text("notes"),

    /** Folded searchable surface shared by the meeting register and global search. */
    searchText: text("search_text").generatedAlwaysAs(
      sql`app.fold_text(
        coalesce(meeting_number, '') || ' ' ||
        coalesce(meeting_location, '') || ' ' ||
        coalesce(research_deputy, '') || ' ' ||
        coalesce(meeting_day, '') || ' ' ||
        coalesce(notes, '')
      )`,
    ),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("meetings_tenant_id_idx").on(table.tenantId, table.id),
    /*
     * One sitting per number per institution. Partial, so a sitting entered
     * twice and retired once does not block the number being re-used — which
     * happens whenever a clerk corrects a mis-keyed number.
     */
    uniqueIndex("meetings_tenant_number_idx")
      .on(table.tenantId, table.meetingNumber)
      .where(sql`deleted_at is null`),
    index("meetings_tenant_recent_idx").on(table.tenantId, sql`meeting_date desc`),
    index("meetings_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
  ],
);

/**
 * The people invited to every sitting.
 *
 * Their purpose is to seed a new meeting's attendance list, so the office does
 * not retype the same nineteen names each fortnight — and that is exactly why
 * the name alone is not enough. A roster typed by hand says «دکتر موسوي» while
 * the directory says «موسوی», and every attendance list seeded from it inherits
 * the spelling.
 *
 * So a seat carries the directory row it belongs to. Unlike a minute, this is
 * not a document: it is the answer to «who sits on the council *now*», and it is
 * right for it to follow a member who is renamed. `professorId` is nullable
 * because the council seats an education-office representative and a
 * graduate-studies officer who hold no professorship, and `memberName` stays
 * required either way, because the name is what the attendance list is seeded
 * with.
 */
export const councilPermanentMembers = pgTable(
  "council_permanent_members",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    memberName: text("member_name").notNull(),
    professorId: uuid("professor_id"),
    /** The order the names are read out in, which is the council's own. */
    sortOrder: integer("sort_order").notNull().default(0),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.professorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "permanent_members_professor_tenant_fk",
    }).onDelete("no action"),
    /* One seat per name per institution, ignoring retired rows — so a member
       removed and re-added does not collide with their own old seat. */
    uniqueIndex("permanent_members_tenant_name_idx")
      .on(table.tenantId, table.memberName)
      .where(sql`deleted_at is null`),
    index("permanent_members_tenant_order_idx").on(table.tenantId, table.sortOrder),
  ],
);

export const councilDecisions = pgTable(
  "council_decisions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /*
     * Text, and that is the archive's decision rather than a modelling slip:
     * sittings are minuted as «۶۷۹» and occasionally «۶۷۹ (فوق‌العاده)». An
     * integer column would have to reject the second, and the second is a real
     * sitting with real decisions in it.
     */
    meetingNumber: text("meeting_number").notNull(),
    meetingDate: date("meeting_date"),

    /*
     * The student is referenced *and* denormalised, on purpose.
     *
     * `student_id` is the link. `student_number` and `student_name` are what the
     * minutes actually said, kept because a decision is a historical document:
     * the person may later be renamed, corrected or retired, and the minute must
     * still read the way it was signed. It is also what lets a decision be filed
     * before its student record exists, which is the ordinary order of events.
     */
    studentId: uuid("student_id"),
    studentNumber: text("student_number"),
    studentName: text("student_name"),

    /*
     * The sitting, referenced and denormalised for the same reason the student
     * is: `meeting_id` is the link, and the number and date are what the minute
     * said. A decision is routinely filed before its sitting record exists.
     */
    meetingId: uuid("meeting_id"),
    meetingTime: text("meeting_time"),
    meetingDay: text("meeting_day"),
    meetingLocation: text("meeting_location"),

    educationLevel: text("education_level"),
    fieldOfStudy: text("field_of_study"),
    thesisCode: text("thesis_code"),
    thesisTitle: text("thesis_title"),
    researchType: text("research_type"),
    /** Canonical period/template references; textual decision content remains immutable history. */
    academicPeriodId: uuid("academic_period_id"),
    templateVersionId: uuid("template_version_id"),
    workflowState: text("workflow_state").notNull().default("draft"),
    finalizedVersionId: uuid("finalized_version_id"),

    /*
     * ── The board, as written names ──────────────────────────────────────
     *
     * Eleven seats, all `text`, and that is deliberate rather than lazy. The
     * council appoints guest reviewers from other universities who are not in
     * this institution's professor directory and never will be; a foreign key
     * would make those sittings unrecordable. `personRefs` links the names that
     * *are* in the directory, so a renamed professor stays attached to the
     * decisions they sat on while the minute keeps the spelling it was signed
     * with.
     */
    primarySupervisor: text("primary_supervisor"),
    secondarySupervisor: text("secondary_supervisor"),
    thirdSupervisor: text("third_supervisor"),
    firstAdvisor: text("first_advisor"),
    secondAdvisor: text("second_advisor"),
    thirdAdvisor: text("third_advisor"),
    reviewer1: text("reviewer1"),
    reviewer2: text("reviewer2"),
    reviewer3: text("reviewer3"),
    reviewer4Invited: text("reviewer4_invited"),
    graduateStudiesRepresentative: text("graduate_studies_representative"),
    personRefs: jsonb("person_refs").$type<Record<string, string>>(),

    /* ── Who signs the worksheets this decision produces ─────────────── */
    facultyDean: text("faculty_dean"),
    departmentCouncil: text("department_council"),
    educationOffice: text("education_office"),
    educationalCulturalDeputy: text("educational_cultural_deputy"),
    researchDeputy: text("research_deputy"),
    departmentHead: text("department_head"),
    groupManager: text("group_manager"),

    /* ── The defence sitting, which is not the council's own ──────────── */
    defenseMeetingDate: date("defense_meeting_date"),
    defenseMeetingTime: text("defense_meeting_time"),
    defenseMeetingDay: text("defense_meeting_day"),
    defenseMeetingLocation: text("defense_meeting_location"),
    proposalDefenseDate: date("proposal_defense_date"),

    /*
     * ── The dossier's paperwork ──────────────────────────────────────────
     *
     * Booleans, because the question the council asks is "is it in the file",
     * not "where is it". The office keeps the paper; this records whether the
     * checklist item is satisfied, which is what the permit forms print and
     * what the record page's checklist counts.
     */
    finalProposalFile: boolean("final_proposal_file"),
    proposalDefensePermitForm: boolean("proposal_defense_permit_form"),
    researchBackground: boolean("research_background"),
    similarityCertificate: boolean("similarity_certificate"),
    labSafetyCertificate: boolean("lab_safety_certificate"),
    bioethicsCertificate: boolean("bioethics_certificate"),
    /** The ethics committee's reference, when there is one. */
    bioethicsCode: text("bioethics_code"),
    languageCertificate: boolean("language_certificate"),
    thesisFile: boolean("thesis_file"),
    defensePermitForm: boolean("defense_permit_form"),
    defenseSimilarityCertificate: boolean("defense_similarity_certificate"),
    defenseLanguageCertificate: boolean("defense_language_certificate"),
    researchPerformanceReports: boolean("research_performance_reports"),

    achievements: text("achievements"),

    /*
     * The folded haystack, as the students' and professors' tables have.
     *
     * This table is the archive — it grows for the life of the institution —
     * and three screens search it per keystroke. Folding six columns per row,
     * per query, was a sequential scan with a function call on every row; the
     * generated column folds once at write time and the trigram index below
     * turns every search into an index scan. Same `app.fold_text` on both
     * sides of the predicate, for the reason the students' column gives.
     */
    searchText: text("search_text").generatedAlwaysAs(
      sql`app.fold_text(
        coalesce(student_name, '') || ' ' ||
        coalesce(student_number, '') || ' ' ||
        coalesce(thesis_title, '') || ' ' ||
        coalesce(thesis_code, '') || ' ' ||
        coalesce(meeting_number, '') || ' ' ||
        coalesce(decision_text, '')
      )`,
    ),
    decisionText: text("decision_text"),

    reportCategory: text("report_category"),
    reviewStatus: text("review_status"),
    councilNotes: text("council_notes"),
    notes: text("notes"),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    /*
     * The dashboard's ordering, and the register's default view. Descending on
     * both columns because that is the direction they are always read in, and a
     * matching index means the top of the list is the first page of the index
     * rather than a sort of the whole table.
     */
    uniqueIndex("council_decisions_tenant_id_idx").on(table.tenantId, table.id),
    index("council_tenant_recent_idx").on(
      table.tenantId,
      sql`meeting_date desc`,
      sql`meeting_number desc`,
    ),
    index("council_tenant_student_idx").on(table.tenantId, table.studentId),
    index("council_tenant_meeting_idx").on(table.tenantId, table.meetingId),
    foreignKey({
      columns: [table.tenantId, table.meetingId],
      foreignColumns: [councilMeetings.tenantId, councilMeetings.id],
      name: "decisions_meeting_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.studentId],
      foreignColumns: [students.tenantId, students.id],
      name: "decisions_student_tenant_fk",
    }).onDelete("no action"),
    index("council_tenant_number_idx").on(table.tenantId, table.studentNumber),
    uniqueIndex("council_decision_identity_idx")
      .on(table.tenantId, table.meetingNumber, table.reportCategory, table.thesisCode)
      .where(
        sql`deleted_at is null and report_category is not null and btrim(report_category) <> '' and thesis_code is not null and btrim(thesis_code) <> ''`,
      ),
    /*
     * The attention bell's two predicates.
     *
     * The bell counts pending reviews and defences in the coming weeks on every
     * page load — it is the number beside the bell in the header, and the
     * hottest repeated read in the system. Both counts were sequential scans of
     * this table, which is the archive and only grows; these two indexes turn
     * each into an index scan over one institution's slice.
     */
    index("council_tenant_review_status_idx").on(table.tenantId, table.reviewStatus),
    index("council_tenant_defence_date_idx").on(table.tenantId, table.defenseMeetingDate),
    index("council_decisions_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
  ],
);

/**
 * A ruling: something the council decided that is not a student's dossier.
 *
 * A sitting produces two kinds of business. One is a decision on a named
 * student's proposal or defence — that is `council_decisions`. The other is
 * everything else the council resolves: a policy, a correction to an earlier
 * minute, an instruction to a department. Those have a text and an outcome and
 * no student at all, so forcing them into the dossier table would mean fifty
 * null columns and a register that cannot be read.
 */
export const councilRulings = pgTable(
  "council_rulings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    meetingId: uuid("meeting_id"),
    meetingNumber: text("meeting_number").notNull(),
    meetingDate: date("meeting_date"),
    meetingTime: text("meeting_time"),
    meetingDay: text("meeting_day"),
    meetingLocation: text("meeting_location"),

    reportCategory: text("report_category"),
    reviewStatus: text("review_status"),
    decisionText: text("decision_text"),
    decisionDescription: text("decision_description"),
    /**
     * Which stock wording this was written from, when it was.
     *
     * Not a foreign key and not enforced: templates are edited and retired, and
     * a ruling signed under an older wording must keep the text it was signed
     * with. This is here to answer "which of these forty rulings came from the
     * template we have just found a mistake in", which is a question the office
     * asks and cannot otherwise answer.
     */
    templateId: text("template_id"),
    /** Immutable database-backed template version; templateId remains a historical/legacy key. */
    templateVersionId: uuid("template_version_id"),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.meetingId],
      foreignColumns: [councilMeetings.tenantId, councilMeetings.id],
      name: "rulings_meeting_tenant_fk",
    }).onDelete("no action"),
    index("rulings_tenant_meeting_idx").on(table.tenantId, table.meetingId),
    index("rulings_tenant_recent_idx").on(table.tenantId, sql`meeting_date desc`),
    index("council_rulings_template_version_idx")
      .on(table.tenantId, table.templateVersionId)
      .where(sql`${table.templateVersionId} is not null`),
  ],
);

/**
 * An appointment: the sitting at which a student was given their supervisors.
 *
 * Its own table rather than three more columns on the student, because it is an
 * *event with a date* and the student record holds only the current state. A
 * student whose second supervisor changed at sitting ۶۸۱ has two appointments;
 * the register shows the change, and `students.primary_supervisor_id` shows only
 * where it landed.
 *
 * The three chairs are real references here, unlike the decision's board: an
 * appointment is this institution appointing its own staff, and a supervisor
 * from another university is not something the council can resolve.
 */
export const councilAppointments = pgTable(
  "council_appointments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    meetingId: uuid("meeting_id"),
    meetingNumber: text("meeting_number").notNull(),
    meetingDate: date("meeting_date"),
    meetingTime: text("meeting_time"),
    meetingDay: text("meeting_day"),
    meetingLocation: text("meeting_location"),

    studentId: uuid("student_id"),
    studentNumber: text("student_number"),
    studentName: text("student_name"),
    educationLevel: text("education_level"),
    fieldOfStudy: text("field_of_study"),

    primarySupervisorId: uuid("primary_supervisor_id"),
    secondarySupervisorId: uuid("secondary_supervisor_id"),
    thirdSupervisorId: uuid("third_supervisor_id"),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    index("appointments_tenant_meeting_idx").on(table.tenantId, table.meetingId),
    index("appointments_tenant_student_idx").on(table.tenantId, table.studentId),
    index("appointments_tenant_recent_idx").on(table.tenantId, sql`meeting_date desc`),
    foreignKey({
      columns: [table.tenantId, table.meetingId],
      foreignColumns: [councilMeetings.tenantId, councilMeetings.id],
      name: "appointments_meeting_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.studentId],
      foreignColumns: [students.tenantId, students.id],
      name: "appointments_student_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.primarySupervisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "appointments_primary_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.secondarySupervisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "appointments_secondary_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.thirdSupervisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "appointments_third_tenant_fk",
    }).onDelete("no action"),
  ],
);
