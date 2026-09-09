import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, user } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";

export const attentionSummary = pgTable(
  "attention_summary",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    count: integer("count").notNull().default(0),
    payload: text("payload").notNull().default("{}"),
    lastCalculatedAt: timestamp("last_calculated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("attention_summary_tenant_user_category_idx").on(
      table.tenantId,
      table.userId,
      table.category,
    ),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "attention_summary_user_tenant_fk",
    }).onDelete("cascade"),
    check("attention_summary_count_check", sql`${table.count} >= 0`),
    check("attention_summary_payload_json_check", sql`${table.payload} is json object`),
  ],
);

export const searchDocuments = pgTable(
  "search_documents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    href: text("href").notNull(),
    searchText: text("search_text").notNull(),
    visibilityCapability: text("visibility_capability"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("search_documents_tenant_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
    ),
    index("search_documents_tenant_type_idx").on(
      table.tenantId,
      table.entityType,
      table.sourceUpdatedAt,
    ),
    index("search_documents_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
  ],
);

export const tenantFeatures = pgTable(
  "tenant_features",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    feature: text("feature").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: text("config").notNull().default("{}"),
    ...concurrency,
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tenant_features_tenant_feature_idx").on(table.tenantId, table.feature),
    check("tenant_features_config_json_check", sql`${table.config} is json object`),
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    dataType: text("data_type").notNull(),
    required: boolean("required").notNull().default(false),
    optionsJson: text("options_json").notNull().default("[]"),
    position: integer("position").notNull().default(0),
    status: text("status").notNull().default("active"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("custom_field_definitions_tenant_entity_key_idx")
      .on(table.tenantId, table.entityType, table.key)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("custom_field_definitions_tenant_id_idx").on(table.tenantId, table.id),
    check(
      "custom_field_definitions_type_check",
      sql`${table.dataType} in ('text','number','date','boolean','select','multiselect')`,
    ),
    check(
      "custom_field_definitions_entity_check",
      sql`${table.entityType} in ('student','professor','workshop','research_project','correspondence')`,
    ),
    check("custom_field_definitions_key_check", sql`${table.key} ~ '^[a-z][a-z0-9_]{1,63}$'`),
    check("custom_field_definitions_status_check", sql`${table.status} in ('active','retired')`),
    check("custom_field_definitions_options_json_check", sql`${table.optionsJson} is json array`),
  ],
);

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    definitionId: uuid("definition_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    valueJson: text("value_json").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("custom_field_values_tenant_definition_entity_idx").on(
      table.tenantId,
      table.definitionId,
      table.entityType,
      table.entityId,
    ),
    index("custom_field_values_entity_idx").on(table.tenantId, table.entityType, table.entityId),
    foreignKey({
      columns: [table.tenantId, table.definitionId],
      foreignColumns: [customFieldDefinitions.tenantId, customFieldDefinitions.id],
      name: "custom_field_values_definition_tenant_fk",
    }).onDelete("cascade"),
    check(
      "custom_field_values_entity_check",
      sql`${table.entityType} in ('student','professor','workshop','research_project','correspondence')`,
    ),
    check("custom_field_values_value_json_check", sql`${table.valueJson} is json`),
  ],
);

export const userRecordPins = pgTable(
  "user_record_pins",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    labelSnapshot: text("label_snapshot").notNull(),
    href: text("href").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_record_pins_owner_entity_idx").on(
      table.tenantId,
      table.userId,
      table.entityType,
      table.entityId,
    ),
    index("user_record_pins_owner_time_idx").on(table.tenantId, table.userId, table.updatedAt),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "user_record_pins_user_tenant_fk",
    }).onDelete("cascade"),
  ],
);

export const recentRecords = pgTable(
  "recent_records",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    labelSnapshot: text("label_snapshot").notNull(),
    href: text("href").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("recent_records_owner_entity_idx").on(
      table.tenantId,
      table.userId,
      table.entityType,
      table.entityId,
    ),
    index("recent_records_owner_time_idx").on(table.tenantId, table.userId, table.openedAt),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "recent_records_user_tenant_fk",
    }).onDelete("cascade"),
  ],
);
