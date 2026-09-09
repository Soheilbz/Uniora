import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { professors, students } from "./registry.ts";

/* ── Workshops ────────────────────────────────────────────────────────────── */

/**
 * A workshop the office ran, and who was in the room.
 *
 * Four tables rather than one, because the three things attached to a workshop
 * are genuinely lists of different shapes: participants can be students or
 * outsiders, instructors can be staff or guests, and a certificate exists only
 * once somebody has attended.
 */
export const workshops = pgTable(
  "workshops",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    title: text("title").notNull(),
    description: text("description"),
    workshopDate: date("workshop_date"),
    /**
     * Hours, to a fraction.
     *
     * `numeric`, not a float: a certificate prints this number, and «۱٫۵ ساعت»
     * arriving as 1.4999999 on the one machine that rounds differently is a
     * printed instrument that disagrees with the register.
     */
    durationHours: numeric("duration_hours", { precision: 5, scale: 2 }),
    locationType: text("location_type"),
    venue: text("venue"),
    /** How many places there are; zero means no limit was set. */
    capacity: integer("capacity").notNull().default(0),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    status: text("status").notNull().default("planned"),
    /** Optional canonical academic period for reporting. */
    academicPeriodId: uuid("academic_period_id"),
    /** Public registration is explicit; existing workshops remain private. */
    publicRegistration: boolean("public_registration").notNull().default(false),
    publicSlug: text("public_slug"),
    registrationClosesAt: date("registration_closes_at"),

    /** Folded searchable surface shared by the workshop register and global search. */
    searchText: text("search_text").generatedAlwaysAs(
      sql`app.fold_text(
        coalesce(title, '') || ' ' ||
        coalesce(venue, '') || ' ' ||
        coalesce(description, '')
      )`,
    ),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("workshops_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("workshops_tenant_public_slug_idx")
      .on(table.tenantId, table.publicSlug)
      .where(sql`${table.publicSlug} is not null and ${table.deletedAt} is null`),
    index("workshops_tenant_date_idx").on(table.tenantId, sql`workshop_date desc`),
    index("workshops_tenant_status_idx").on(table.tenantId, table.status),
    index("workshops_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
  ],
);

/**
 * Somebody who took a workshop.
 *
 * A student *or* an outsider, and the shape carries both: `studentId` links the
 * ones on the register, and the `external*` columns hold the ones who are not —
 * staff from another faculty, a visiting researcher, somebody from industry.
 * Requiring a student record for each would mean inventing student numbers for
 * people who are not students.
 */
export const workshopParticipants = pgTable(
  "workshop_participants",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    workshopId: uuid("workshop_id").notNull(),
    studentId: uuid("student_id"),
    externalName: text("external_name"),
    externalNationalId: text("external_national_id"),
    externalMobile: text("external_mobile"),
    externalAffiliation: text("external_affiliation"),

    registrationDate: date("registration_date"),
    attendanceStatus: text("attendance_status").notNull().default("registered"),
    paymentStatus: text("payment_status").notNull().default("free"),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("participants_tenant_id_idx").on(table.tenantId, table.id),
    index("participants_tenant_workshop_idx").on(table.tenantId, table.workshopId),
    index("participants_tenant_student_idx").on(table.tenantId, table.studentId),

    /*
     * One person, one place, on one workshop's register.
     *
     * Nothing above this refuses a repeat. Pressing «ثبت» twice wrote two rows,
     * and a duplicate is not merely untidy: seats are counted by rows, so it
     * takes a place from somebody; attendance is taken per row, so the same
     * person is marked present twice; and a certificate is issued per
     * participant, so one person ends up holding two numbered certificates for
     * one day's workshop.
     *
     * The form asks the question before the press — a constraint that fires is
     * a worse experience than one answered in advance — but a check the
     * application makes is a check against a copy of the register read a moment
     * ago, and two clerks registering the same student at the same time both
     * read a roster without them. Only the database can be the arbiter.
     *
     * `deleted_at is null` for the reason every business-key index here is
     * partial: deletes are soft, and an index over tombstones would reserve a
     * person's place for ever — cancelling a registration and re-entering it
     * would fail against a row nobody can see.
     *
     * `student_id is not null` because a guest's registration has no student
     * and PostgreSQL treats each of those NULLs as distinct anyway; stating it
     * makes the index smaller and its intent readable.
     *
     * The blank exemption on the guest identifier is a judgement, not an
     * optimisation. A guest is identified by their national id and the field is
     * optional, so two guests with nothing recorded are either one person twice
     * or two people, and nothing can tell which. Refusing the second would
     * leave the register unable to hold two guests whose ids nobody has yet —
     * a rule inventing a fact — so blanks are exempt and the report counts
     * them instead.
     */
    uniqueIndex("participants_tenant_workshop_student_idx")
      .on(table.tenantId, table.workshopId, table.studentId)
      .where(sql`deleted_at is null and student_id is not null`),
    uniqueIndex("participants_tenant_workshop_guest_idx")
      .on(table.tenantId, table.workshopId, table.externalNationalId)
      .where(
        sql`deleted_at is null and external_national_id is not null and btrim(external_national_id) <> ''`,
      ),
    foreignKey({
      columns: [table.tenantId, table.workshopId],
      foreignColumns: [workshops.tenantId, workshops.id],
      name: "participants_workshop_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.studentId],
      foreignColumns: [students.tenantId, students.id],
      name: "participants_student_tenant_fk",
    }).onDelete("no action"),
  ],
);

/** Who taught it — staff by reference, guests by name. */
export const workshopInstructors = pgTable(
  "workshop_instructors",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    workshopId: uuid("workshop_id").notNull(),
    professorId: uuid("professor_id"),
    externalName: text("external_name"),
    externalNationalId: text("external_national_id"),
    externalAffiliation: text("external_affiliation"),
    role: text("role").notNull().default("main"),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    index("instructors_tenant_workshop_idx").on(table.tenantId, table.workshopId),
    foreignKey({
      columns: [table.tenantId, table.workshopId],
      foreignColumns: [workshops.tenantId, workshops.id],
      name: "instructors_workshop_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.professorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "instructors_professor_tenant_fk",
    }).onDelete("no action"),
  ],
);

/**
 * A certificate issued to somebody who attended.
 *
 * Its own table rather than three columns on the participant, because a
 * certificate is an *instrument*: it has a number that must be unique, a date it
 * was issued on, and a code somebody can quote to verify it. A participant who
 * has not been issued one has no certificate, not a certificate with empty
 * fields — and the difference is what the register reports.
 */
export const workshopCertificates = pgTable(
  "workshop_certificates",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    workshopId: uuid("workshop_id").notNull(),
    participantId: uuid("participant_id").notNull(),

    certificateNumber: text("certificate_number").notNull(),
    issueDate: date("issue_date").notNull(),
    /**
     * The code printed on the certificate for whoever checks it later.
     *
     * Separate from the number: the number is the office's sequence and is
     * guessable, so it cannot be what proves a certificate genuine. This is a
     * random string, unique per institution, and it is the whole of the
     * verification story — a certificate is a piece of paper that leaves the
     * building, and its number alone would let anybody mint one.
     */
    verificationCode: text("verification_code").notNull(),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("certificates_tenant_number_idx")
      .on(table.tenantId, table.certificateNumber)
      .where(sql`deleted_at is null`),
    uniqueIndex("certificates_tenant_code_idx")
      .on(table.tenantId, table.verificationCode)
      .where(sql`deleted_at is null`),
    /*
     * One certificate per participant per workshop. Somebody who attends twice
     * has two participations and two certificates; somebody issued a second for
     * the same attendance has a duplicate, which is what this refuses.
     */
    uniqueIndex("certificates_tenant_participant_idx")
      .on(table.tenantId, table.participantId)
      .where(sql`deleted_at is null`),
    index("certificates_tenant_workshop_idx").on(table.tenantId, table.workshopId),
    foreignKey({
      columns: [table.tenantId, table.workshopId],
      foreignColumns: [workshops.tenantId, workshops.id],
      name: "certificates_workshop_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.participantId],
      foreignColumns: [workshopParticipants.tenantId, workshopParticipants.id],
      name: "certificates_participant_tenant_fk",
    }).onDelete("cascade"),
  ],
);
