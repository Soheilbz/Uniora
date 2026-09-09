import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";

/* ── The registry ─────────────────────────────────────────────────────────── */

/**
 * The institution's own vocabularies.
 *
 * Degrees, standings, faculties, departments, fields of study, admission
 * routes — the words an office files people under. They are rows rather than a
 * TypeScript union because they are not the software's to decide: one
 * university has eight degrees and another eleven, a faculty is created by a
 * decree this system never sees, and a standing that stops being offered still
 * has to render on the records already carrying it.
 *
 * `position` rather than alphabetical, because these are ordered sets and the
 * order is the office's. Sorted by the stored key instead, «مقطع» came out as
 * bachelor, master, ph_d_17rsace, phd, professional_doctorate — the right
 * groups in an order with no meaning on screen.
 *
 * `retiredAt` rather than deletion, for the same reason: an entry no longer
 * offered must vanish from the form and stay legible on the four hundred
 * records already filed under it. Deleted, those records display a bare key.
 */
export const lookups = pgTable(
  "lookups",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /** Which vocabulary: `degrees`, `student_statuses`, `faculties`, … */
    set: text("set").notNull(),
    /** The stored value — what a record's own column holds. */
    value: text("value").notNull(),
    /** What an operator reads. */
    label: text("label").notNull(),

    /**
     * The entry this one sits under, for the vocabularies that nest.
     *
     * A department belongs to a faculty and a field to a department, and the
     * form uses that to offer only what the level above actually contains.
     * Without it a clerk who picks a faculty still scrolls every department in
     * the institution — and can file a student in one that faculty does not
     * have.
     */
    parentId: uuid("parent_id"),

    position: integer("position").notNull().default(0),
    retiredAt: timestamp("retired_at", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("lookups_tenant_set_value_idx").on(table.tenantId, table.set, table.value),
    index("lookups_tenant_set_position_idx").on(table.tenantId, table.set, table.position),
    uniqueIndex("lookups_tenant_id_idx").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.parentId],
      foreignColumns: [table.tenantId, table.id],
      name: "lookups_parent_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * The institution as it appears on paper.
 *
 * ── Why this is not columns on `tenants` ────────────────────────────────────
 *
 * `tenants` is the boundary: a row there is what every policy in the database
 * compares against, and the application connects as a role that cannot write to
 * it. That is deliberate — an application that can rename a tenant is an
 * application that can be made to move rows between universities. The
 * letterhead is ordinary institutional data that an administrator edits, so it
 * lives in an ordinary table under the ordinary policy.
 *
 * ── Why the crest is a column and not a file path ───────────────────────────
 *
 * A form is printed from a server the office does not administer, and a path
 * into a filesystem is a path that survives exactly until the next deploy. The
 * image is small — a crest at print resolution is tens of kilobytes — and it is
 * read once per printed sheet, so it is stored where the rest of the letterhead
 * is and travels with the backup that already exists.
 */
export const institutions = pgTable(
  "institutions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /** The first line of the letterhead — «دانشگاه فردوسی مشهد». */
    name: text("name").notNull().default(""),
    /**
     * The same name in English, for a bilingual sheet.
     *
     * Not a translation this software can perform: a university's English name
     * is a decision the university has made and registered, and «Ferdowsi
     * University of Mashhad» is not what any transliteration of the Persian
     * produces. So it is a field, and a sheet that needs it and does not have
     * it prints the Persian alone rather than a guess.
     */
    nameEn: text("name_en").notNull().default(""),
    /** The second — «دانشکده‌ی دامپزشکی». */
    faculty: text("faculty").notNull().default(""),
    /**
     * Which university this deployment *is*, as a `universities` value.
     *
     * The name above is a heading on a letter; this is an identity the software
     * compares against. The capacity regulation's proviso 7 halves a joint
     * supervision only between members of this university's own faculty, so the
     * engine has to be able to ask «is this colleague one of ours» — and every
     * professor's `university` column already answers in this vocabulary.
     *
     * Empty until an administrator sets it, and the engine reads empty as «not
     * configured»: no seat counts as own faculty, so first supervisors are
     * charged in full rather than halved. That is the conservative direction,
     * and the capacity screen says the input is missing rather than quietly
     * computing on a guess.
     */
    university: text("university").notNull().default(""),

    /*
     * The rest of a letterhead, which the forms do not print today.
     *
     * They are here because they are what an institution profile *is*, and
     * because the correspondence module will need every one of them: a letter
     * that goes outside the university carries an address and a telephone
     * number, and adding a column then means a migration then. Blank until
     * somebody fills them, and nothing prints a blank.
     */
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    website: text("website").notNull().default(""),
    /** IANA time zone used for university-local dates and deadlines. */
    timezone: text("timezone").notNull().default("Asia/Tehran"),
    locale: text("locale").notNull().default("fa"),
    calendarSystem: text("calendar_system").notNull().default("jalali"),
    // Reserved for a future academic-year reporting model. It is intentionally
    // not exposed in Settings until a report actually consumes it.
    academicYearStartMonth: integer("academic_year_start_month").notNull().default(7),
    /* Retained for migration compatibility; tenant MFA is intentionally
       disabled. Platform operator MFA is controlled outside tenant policy. */
    requireAdminMfa: boolean("require_admin_mfa").notNull().default(false),
    sessionHours: integer("session_hours").notNull().default(8),
    /** Tenant may require a stronger password than the platform floor. */
    passwordMinLength: integer("password_min_length").notNull().default(12),

    /**
     * The crest, as a data URI.
     *
     * Stored whole rather than as bytes plus a type, because every consumer
     * wants exactly that string: `<img src>` on a printed sheet takes it
     * directly, and a column holding two halves would be reassembled at every
     * one of them. Empty means no crest, and a sheet with no crest prints
     * without one rather than with a placeholder.
     */
    crest: text("crest").notNull().default(""),

    version: integer("version").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    /* One profile to an institution. Two would be two letterheads, and nothing
       on a printed form says which of them it came from. */
    uniqueIndex("institutions_tenant_idx").on(table.tenantId),
    check(
      "institutions_academic_month_check",
      sql`${table.academicYearStartMonth} between 1 and 12`,
    ),
    check("institutions_session_hours_check", sql`${table.sessionHours} between 1 and 24`),
    check(
      "institutions_password_min_length_check",
      sql`${table.passwordMinLength} between 12 and 64`,
    ),
    check("institutions_locale_check", sql`${table.locale} in ('fa','en')`),
    check("institutions_calendar_check", sql`${table.calendarSystem} in ('jalali','gregorian')`),
  ],
);

/**
 * The office's own entries on the calendar.
 *
 * ── The one thing on that screen that is written there ──────────────────────
 *
 * The calendar shows four kinds of thing: council sittings, defences, workshops
 * and these. The first three are rows in registers that own them, and the
 * calendar projects them read-only — a sitting moved on the calendar and not in
 * the minutes would be two answers to when the council met. Only these exist
 * because somebody put them there, and only these are editable from it.
 *
 * ── Why there is no link to a record ────────────────────────────────────────
 *
 * An entry is a note about a day: a deadline, a visit, a closure. Anything that
 * belongs to a student or a sitting already has a row in the register that owns
 * it, and giving this table a foreign key would invite a second, weaker copy of
 * records that already exist.
 */
export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /* ── Identity ────────────────────────────────────────────────────────
     *
     * Every identifier here is `text`, and none of them is a number. A student
     * number carries leading zeros that are part of it, a national id is
     * exactly ten digits with a check digit, and a passport number is not
     * numeric at all. Held as integers they lose the zeros silently and come
     * back as a different person's number.
     */
    studentNumber: text("student_number").notNull(),
    nationalId: text("national_id"),
    idNumber: text("id_number"),
    passportNumber: text("passport_number"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    fatherName: text("father_name"),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    nationality: text("nationality"),
    birthDate: date("birth_date"),
    /**
     * The year alone, for the records that carry only that.
     *
     * The archive holds people whose file gives «۱۳۶۲» and no day, and a date
     * column cannot hold that without inventing a first of Farvardin that was
     * never on the form. Jalali years — the range is 1280–1500.
     */
    birthYear: integer("birth_year"),
    birthPlace: text("birth_place"),
    militaryStatusType: text("military_status_type"),
    militaryStatus: text("military_status"),

    /* ── Academic standing ───────────────────────────────────────────── */
    degree: text("degree"),
    status: text("status").notNull().default("enrolled"),
    admissionDate: date("admission_date"),
    sourceUniversity: text("source_university"),
    faculty: text("faculty"),
    department: text("department"),
    fieldOfStudy: text("field_of_study"),

    /** Canonical master-data links; the text columns above remain the historical snapshot. */
    organizationUnitId: uuid("organization_unit_id"),
    academicProgramId: uuid("academic_program_id"),
    admissionPeriodId: uuid("admission_period_id"),

    /*
     * Supervision, as real references rather than copied names.
     *
     * A professor who marries, or whose name the office later corrects the
     * spelling of, stays attached to every student they supervise. The
     * directory uses retirement rather than physical deletion. A restrictive
     * tenant-aware foreign key is deliberate: PostgreSQL cannot apply
     * `SET NULL` to only the referenced id in this composite key, so a plain
     * `SET NULL` would also null the required tenant id.
     */
    primarySupervisorId: uuid("primary_supervisor_id"),
    secondarySupervisorId: uuid("secondary_supervisor_id"),
    thirdSupervisorId: uuid("third_supervisor_id"),
    advisorId: uuid("advisor_id"),

    admissionType: text("admission_type"),
    /*
     * Beside the admission route rather than folded into it: «بورسیه» says who
     * pays and «کنکور» says how they got in, and the archive holds students for
     * whom both are true at once.
     */
    fundingType: text("funding_type"),
    entryMethod: text("entry_method"),
    quota: text("quota"),

    /* ── Contact ─────────────────────────────────────────────────────── */
    phone: text("phone"),
    email: text("email"),

    /* ── Prior degree and progress ───────────────────────────────────── */
    previousUniversity: text("previous_university"),
    previousStudentNumber: text("previous_student_number"),
    previousField: text("previous_field"),
    /** Grade points on the Iranian 0–20 scale, to two places. */
    previousGpa: numeric("previous_gpa", { precision: 4, scale: 2 }),
    previousGraduationDate: date("previous_graduation_date"),
    previousGraduationConfirmed: boolean("previous_graduation_confirmed"),
    overallGpa: numeric("overall_gpa", { precision: 4, scale: 2 }),
    diplomaType: text("diploma_type"),
    diplomaWrittenGpa: numeric("diploma_written_gpa", { precision: 4, scale: 2 }),
    diplomaGpa: numeric("diploma_gpa", { precision: 4, scale: 2 }),
    completedUnits: integer("completed_units"),
    currentSemesterUnits: integer("current_semester_units"),
    semestersCount: integer("semesters_count"),
    academicStatusIncluded: boolean("academic_status_included"),
    academicStatusExcluded: boolean("academic_status_excluded"),
    militaryLetterStatus: text("military_letter_status"),

    /**
     * What the register's search box actually matches against.
     *
     * `GENERATED ALWAYS … STORED`, so it is maintained by PostgreSQL on every
     * insert and update and cannot drift from the columns it summarises. The
     * alternative — a trigger, or the application remembering to recompute it —
     * fails in the one way that matters: silently, on the record somebody edited
     * without going through the usual path, which then becomes unfindable.
     *
     * `app.fold_text` collapses the Persian letter and digit variants (see
     * `db/sql/before/0001_text_folding.sql`). The search predicate folds the
     * needle with the *same* function; if the two ever diverge the index still
     * answers, just never with a match, so both sides call one function
     * deliberately rather than sharing a copied expression.
     */
    searchText: text("search_text").generatedAlwaysAs(
      sql`app.fold_text(
        coalesce(student_number, '') || ' ' ||
        coalesce(national_id, '') || ' ' ||
        coalesce(first_name, '') || ' ' ||
        coalesce(last_name, '') || ' ' ||
        coalesce(father_name, '')
      )`,
    ),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    /*
     * Unique per institution, not globally: two universities issue their own
     * numbering and they collide constantly. Partial, so a retired record does
     * not block the number being reused — which offices do.
     */
    uniqueIndex("students_tenant_number_idx")
      .on(table.tenantId, table.studentNumber)
      .where(sql`deleted_at is null`),
    index("students_tenant_name_idx").on(table.tenantId, table.lastName, table.firstName),

    /*
     * The columns the register filters on, each led by `tenant_id`.
     *
     * Every read is already narrowed to one institution — row-level security
     * puts that predicate there whether the query asks for it or not — so an
     * index that does not lead with it matches every university's rows and then
     * discards all but one institution's.
     */
    index("students_tenant_status_idx").on(table.tenantId, table.status),
    index("students_tenant_degree_idx").on(table.tenantId, table.degree),
    index("students_tenant_department_idx").on(table.tenantId, table.department),
    /*
     * The two filters the register offers that had no index behind them.
     *
     * «Faculty» and «field of study» are on the filter strip and in the
     * reports' groupings; unindexed, choosing either was a scan of the
     * institution's whole register — invisible at a hundred rows, the dominant
     * cost of the screen at forty thousand.
     */
    index("students_tenant_faculty_idx").on(table.tenantId, table.faculty),
    index("students_tenant_field_idx").on(table.tenantId, table.fieldOfStudy),

    /*
     * Trigram index on the folded text, which is what makes the search box
     * usable on an archive rather than a demo.
     *
     * A `LIKE '%…%'` predicate cannot use a B-tree at all — the leading wildcard
     * defeats it — so without this every keystroke is a sequential scan of every
     * student in the institution. GIN over trigrams indexes the substrings
     * themselves, so an infix match is an index scan.
     */
    index("students_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
    uniqueIndex("students_tenant_id_idx").on(table.tenantId, table.id),

    foreignKey({
      columns: [table.tenantId, table.primarySupervisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "students_primary_supervisor_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.secondarySupervisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "students_secondary_supervisor_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.thirdSupervisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "students_third_supervisor_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.advisorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "students_advisor_fk",
    }).onDelete("no action"),
  ],
);

export const professors = pgTable(
  "professors",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /* ── Identity, as the personnel file records it ───────────────────── */
    professorCode: text("professor_code"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    fatherName: text("father_name"),
    /*
     * Every identifier here is `text` and none is a number — the same rule the
     * student register follows. A national id carries leading zeros that are
     * part of it, and an integer column would eat them silently.
     */
    nationalId: text("national_id"),
    birthCertificateNumber: text("birth_certificate_number"),
    certificateIssueDate: date("certificate_issue_date"),
    birthDate: date("birth_date"),
    birthPlace: text("birth_place"),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    nationality: text("nationality"),
    veteranStatus: text("veteran_status"),

    /* ── Academic standing ────────────────────────────────────────────── */
    academicRank: text("academic_rank"),
    lastDegree: text("last_degree"),
    specialization: text("specialization"),
    activityField: text("activity_field"),
    department: text("department"),
    faculty: text("faculty"),
    university: text("university"),
    /** Canonical department/faculty identity; `department`/`faculty` stay as snapshots. */
    organizationUnitId: uuid("organization_unit_id"),
    /**
     * Whether this is a member of faculty or somebody teaching by the hour.
     *
     * It decides what a person may be appointed to, so it is a column and not a
     * note: a visiting lecturer does not chair an examining board.
     *
     * «yes», «no», or nothing — and the nullable text is the point. Held as
     * `boolean NOT NULL DEFAULT true`, every record transcribed from a personnel
     * file that never asked the question became a stated «yes», which is exactly
     * the answer that qualifies somebody to chair a board. A directory is
     * allowed not to know something; it is not allowed to invent the answer.
     */
    isFacultyMember: text("is_faculty_member"),

    /* ── Employment ───────────────────────────────────────────────────── */
    employmentStatus: text("employment_status"),
    status: text("status"),
    grade: text("grade"),
    hireDate: date("hire_date"),
    dependency: text("dependency"),
    workplace: text("workplace"),
    workplaceRegion: text("workplace_region"),
    specialConditions: text("special_conditions"),

    /*
     * No document paths.
     *
     * Attachments are not represented as local filesystem paths. A multi-instance
     * Web service requires managed object storage and explicit attachment metadata.
     */

    /* ── Contact, and how the office pays an examiner ─────────────────── */
    email: text("email"),
    phone: text("phone"),
    virtualLink: text("virtual_link"),
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),

    notes: text("notes"),

    /**
     * The columns the search box reads, folded once and stored.
     *
     * The student register has had this since it was written; this one folded
     * six columns *per row, per keystroke* instead — six `coalesce` calls and a
     * `LIKE '%…%'` that no B-tree can serve, so every character typed was a
     * sequential scan of the whole directory. On a demo of four that is
     * invisible; on a university's two thousand it is the search box being
     * unusable, and on a server it is that for every reader at once.
     *
     * Generated, so it cannot drift from the columns it summarises — a name
     * corrected through any path is folded again by PostgreSQL, not by whichever
     * code happened to perform the write.
     *
     * `app.fold_text` is the same function the predicate folds the needle with.
     * They are one function deliberately: were the two to diverge the index
     * would still answer, just never with a match.
     */
    searchText: text("search_text").generatedAlwaysAs(
      sql`app.fold_text(
        coalesce(first_name, '') || ' ' ||
        coalesce(last_name, '') || ' ' ||
        coalesce(professor_code, '') || ' ' ||
        coalesce(national_id, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(specialization, '')
      )`,
    ),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("professors_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("professors_tenant_code_idx")
      .on(table.tenantId, table.professorCode)
      .where(sql`deleted_at is null and professor_code is not null`),
    index("professors_tenant_name_idx").on(table.tenantId, table.lastName, table.firstName),

    /*
     * The columns the register filters on, each led by `tenant_id` — for the
     * reason set out over the student register's copy: every read already
     * carries a tenant predicate, put there by row-level security whether the
     * query asks for it or not, so an index that does not lead with it matches
     * every university's rows and discards all but one institution's.
     */
    index("professors_tenant_status_idx").on(table.tenantId, table.status),
    index("professors_tenant_rank_idx").on(table.tenantId, table.academicRank),
    index("professors_tenant_university_idx").on(table.tenantId, table.university),
    index("professors_tenant_faculty_idx").on(table.tenantId, table.faculty),
    index("professors_tenant_department_idx").on(table.tenantId, table.department),

    index("professors_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
  ],
);
