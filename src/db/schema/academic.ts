import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  type PgTableWithColumns,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { professors, students } from "./registry.ts";

/** Effective-dated academic years; labels are institutional, not inferred. */
export const academicYears = pgTable(
  "academic_years",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: text("status").notNull().default("planned"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("academic_years_tenant_code_idx")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("academic_years_tenant_id_idx").on(table.tenantId, table.id),
    index("academic_years_tenant_dates_idx").on(table.tenantId, table.startsOn, table.endsOn),
    check("academic_years_dates_check", sql`${table.endsOn} >= ${table.startsOn}`),
    check("academic_years_status_check", sql`${table.status} in ('planned','active','closed')`),
  ],
);

export const academicPeriods = pgTable(
  "academic_periods",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    academicYearId: uuid("academic_year_id").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("semester"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    position: integer("position").notNull().default(0),
    status: text("status").notNull().default("planned"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("academic_periods_tenant_code_idx")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("academic_periods_tenant_id_idx").on(table.tenantId, table.id),
    index("academic_periods_tenant_year_idx").on(
      table.tenantId,
      table.academicYearId,
      table.position,
    ),
    foreignKey({
      columns: [table.tenantId, table.academicYearId],
      foreignColumns: [academicYears.tenantId, academicYears.id],
      name: "academic_periods_year_tenant_fk",
    }).onDelete("restrict"),
    check("academic_periods_dates_check", sql`${table.endsOn} >= ${table.startsOn}`),
    check(
      "academic_periods_kind_check",
      sql`${table.kind} in ('semester','summer','annual','custom')`,
    ),
    check("academic_periods_status_check", sql`${table.status} in ('planned','active','closed')`),
  ],
);

/** Canonical organization tree. Historical records continue to retain snapshots. */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle needs an explicit recursive table shape for the self-referencing organization tree.
export const organizationUnits: PgTableWithColumns<any> = pgTable(
  "organization_units",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id"),
    type: text("type").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    status: text("status").notNull().default("active"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  // biome-ignore lint/suspicious/noExplicitAny: The callback references organizationUnits while its table shape is being initialized.
  (table): any => [
    uniqueIndex("organization_units_tenant_code_idx")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("organization_units_tenant_id_idx").on(table.tenantId, table.id),
    index("organization_units_tenant_parent_idx").on(table.tenantId, table.parentId, table.type),
    foreignKey({
      columns: [table.tenantId, table.parentId],
      foreignColumns: [organizationUnits.tenantId, organizationUnits.id],
      name: "organization_units_parent_tenant_fk",
    }).onDelete("restrict"),
    check(
      "organization_units_type_check",
      sql`${table.type} in ('university','faculty','department','center','institute','office','other')`,
    ),
    check(
      "organization_units_status_check",
      sql`${table.status} in ('active','inactive','merged','closed')`,
    ),
    check(
      "organization_units_dates_check",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);

/** Immutable-ish name/code history for reporting an organization as it existed then. */
export const organizationUnitVersions = pgTable(
  "organization_unit_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    organizationUnitId: uuid("organization_unit_id").notNull(),
    versionNo: integer("version_no").notNull(),
    codeSnapshot: text("code_snapshot").notNull(),
    nameSnapshot: text("name_snapshot").notNull(),
    parentNameSnapshot: text("parent_name_snapshot"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    reason: text("reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organization_unit_versions_tenant_unit_version_idx").on(
      table.tenantId,
      table.organizationUnitId,
      table.versionNo,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationUnitId],
      foreignColumns: [organizationUnits.tenantId, organizationUnits.id],
      name: "organization_unit_versions_unit_tenant_fk",
    }).onDelete("cascade"),
    check(
      "organization_unit_versions_dates_check",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
  ],
);

export const academicPrograms = pgTable(
  "academic_programs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    degreeLevel: text("degree_level").notNull(),
    field: text("field").notNull(),
    orientation: text("orientation"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    status: text("status").notNull().default("active"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("academic_programs_tenant_code_idx")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("academic_programs_tenant_id_idx").on(table.tenantId, table.id),
    index("academic_programs_department_idx").on(
      table.tenantId,
      table.departmentId,
      table.degreeLevel,
    ),
    foreignKey({
      columns: [table.tenantId, table.departmentId],
      foreignColumns: [organizationUnits.tenantId, organizationUnits.id],
      name: "academic_programs_department_tenant_fk",
    }).onDelete("restrict"),
    check(
      "academic_programs_dates_check",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check(
      "academic_programs_status_check",
      sql`${table.status} in ('active','inactive','retired')`,
    ),
  ],
);

/** The canonical supervision timeline; current student pointers remain for compatibility. */
export const studentSupervisionAssignments = pgTable(
  "student_supervision_assignments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    studentId: uuid("student_id").notNull(),
    professorId: uuid("professor_id").notNull(),
    role: text("role").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    sourceDecisionId: uuid("source_decision_id"),
    professorNameSnapshot: text("professor_name_snapshot").notNull(),
    departmentNameSnapshot: text("department_name_snapshot"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    ...concurrency,
    ...timestamps,
  },
  (table) => [
    uniqueIndex("supervision_assignments_tenant_id_idx").on(table.tenantId, table.id),
    index("supervision_assignments_student_timeline_idx").on(
      table.tenantId,
      table.studentId,
      table.validFrom,
    ),
    index("supervision_assignments_professor_timeline_idx").on(
      table.tenantId,
      table.professorId,
      table.validFrom,
    ),
    foreignKey({
      columns: [table.tenantId, table.studentId],
      foreignColumns: [students.tenantId, students.id],
      name: "supervision_assignments_student_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.professorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "supervision_assignments_professor_tenant_fk",
    }).onDelete("restrict"),
    check(
      "supervision_assignments_role_check",
      sql`${table.role} in ('primary_supervisor','secondary_supervisor','third_supervisor','advisor')`,
    ),
    check(
      "supervision_assignments_dates_check",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check(
      "supervision_assignments_status_check",
      sql`${table.status} in ('active','ended','cancelled')`,
    ),
  ],
);
