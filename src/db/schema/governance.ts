import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { session, tenants, user } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { platformOperators } from "./platform.ts";

export const regulationVersions = pgTable(
  "regulation_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    regulationCode: text("regulation_code").notNull(),
    versionCode: text("version_code").notNull(),
    title: text("title").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    publicationReference: text("publication_reference"),
    approvedBy: text("approved_by"),
    rulesJson: text("rules_json").notNull(),
    rulesSha256: text("rules_sha256").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("regulation_versions_tenant_code_version_idx").on(
      table.tenantId,
      table.regulationCode,
      table.versionCode,
    ),
    uniqueIndex("regulation_versions_tenant_id_idx").on(table.tenantId, table.id),
    check(
      "regulation_versions_dates_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(
      "regulation_versions_status_check",
      sql`${table.status} in ('draft','published','retired')`,
    ),
    check("regulation_versions_rules_json_check", sql`${table.rulesJson} is json`),
  ],
);

export const decisionTemplateVersions = pgTable(
  "decision_template_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    templateCode: text("template_code").notNull(),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    bodyTemplate: text("body_template").notNull(),
    schemaJson: text("schema_json").notNull().default("{}"),
    contentSha256: text("content_sha256").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("decision_template_versions_tenant_code_version_idx").on(
      table.tenantId,
      table.templateCode,
      table.versionNo,
    ),
    uniqueIndex("decision_template_versions_tenant_id_idx").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "decision_template_versions_creator_tenant_fk",
    }).onDelete("no action"),
    check("decision_template_versions_version_check", sql`${table.versionNo} > 0`),
    check(
      "decision_template_versions_status_check",
      sql`${table.status} in ('draft','published','retired')`,
    ),
    check("decision_template_versions_schema_json_check", sql`${table.schemaJson} is json object`),
  ],
);

export const qualityRules = pgTable(
  "quality_rules",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    entity: text("entity").notNull(),
    severity: text("severity").notNull().default("warning"),
    enabled: boolean("enabled").notNull().default(true),
    ownerCapability: text("owner_capability"),
    description: text("description").notNull(),
    remediationRoute: text("remediation_route"),
    evaluator: text("evaluator").notNull(),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("quality_rules_tenant_code_idx")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("quality_rules_tenant_id_idx").on(table.tenantId, table.id),
    check(
      "quality_rules_severity_check",
      sql`${table.severity} in ('info','warning','error','critical')`,
    ),
  ],
);

export const qualitySnapshots = pgTable(
  "quality_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    ruleId: uuid("rule_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    count: integer("count").notNull(),
    sampleEntityIds: text("sample_entity_ids").notNull().default("[]"),
    durationMs: integer("duration_ms"),
    ...timestamps,
  },
  (table) => [
    index("quality_snapshots_rule_time_idx").on(table.tenantId, table.ruleId, table.capturedAt),
    foreignKey({
      columns: [table.tenantId, table.ruleId],
      foreignColumns: [qualityRules.tenantId, qualityRules.id],
      name: "quality_snapshots_rule_tenant_fk",
    }).onDelete("cascade"),
    check("quality_snapshots_count_check", sql`${table.count} >= 0`),
    check("quality_snapshots_sample_ids_json_check", sql`${table.sampleEntityIds} is json array`),
  ],
);

export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    resource: text("resource").notNull(),
    retainDays: integer("retain_days").notNull(),
    mode: text("mode").notNull().default("purge"),
    enabled: boolean("enabled").notNull().default(true),
    legalHold: boolean("legal_hold").notNull().default(false),
    ...concurrency,
    ...timestamps,
  },
  (table) => [
    uniqueIndex("retention_policies_tenant_resource_idx").on(table.tenantId, table.resource),
    check("retention_policies_days_check", sql`${table.retainDays} >= 1`),
    check("retention_policies_mode_check", sql`${table.mode} in ('purge','archive')`),
  ],
);

export const piiAccessLog = pgTable(
  "pii_access_log",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    purpose: text("purpose"),
    requestId: text("request_id"),
    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pii_access_log_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.accessedAt,
    ),
    index("pii_access_log_actor_idx").on(table.tenantId, table.actorId, table.accessedAt),
    foreignKey({
      columns: [table.tenantId, table.actorId],
      foreignColumns: [user.tenantId, user.id],
      name: "pii_access_log_actor_tenant_fk",
    }).onDelete("no action"),
  ],
);

export const breakGlassSessions = pgTable(
  "break_glass_sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    platformOperatorId: text("platform_operator_id").notNull(),
    platformSessionId: text("platform_session_id").notNull(),
    reason: text("reason").notNull(),
    approvedBy: text("approved_by"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    tenantNotifiedAt: timestamp("tenant_notified_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    index("break_glass_sessions_active_idx").on(
      table.tenantId,
      table.platformOperatorId,
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      columns: [table.platformOperatorId],
      foreignColumns: [platformOperators.userId],
      name: "break_glass_platform_operator_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.platformSessionId],
      foreignColumns: [session.id],
      name: "break_glass_platform_session_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "break_glass_approver_tenant_fk",
    }).onDelete("no action"),
    check(
      "break_glass_status_check",
      sql`${table.status} in ('active','expired','ended','revoked')`,
    ),
    check("break_glass_duration_check", sql`${table.expiresAt} > ${table.startsAt}`),
    check(
      "break_glass_max_duration_check",
      sql`${table.expiresAt} <= ${table.startsAt} + interval '30 minutes'`,
    ),
  ],
);
