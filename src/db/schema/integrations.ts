import { sql } from "drizzle-orm";
import {
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
import { jobs } from "./operations.ts";

export const serviceAccounts = pgTable(
  "service_accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    capabilities: text("capabilities").notNull().default("[]"),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(120),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("service_accounts_tenant_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("service_accounts_token_hash_idx").on(table.tokenHash),
    uniqueIndex("service_accounts_tenant_id_idx").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "service_accounts_creator_tenant_fk",
    }).onDelete("no action"),
    check(
      "service_accounts_status_check",
      sql`${table.status} in ('active','suspended','revoked')`,
    ),
    check(
      "service_accounts_rate_limit_check",
      sql`${table.rateLimitPerMinute} between 10 and 1000`,
    ),
    check("service_accounts_capabilities_json_check", sql`${table.capabilities} is json array`),
  ],
);

/** Event store for delivery, not event sourcing: domain state stays in domain tables. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: text("payload").notNull().default("{}"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempt: integer("attempt").notNull().default(0),
    lastError: text("last_error"),
    correlationId: text("correlation_id"),
    causationId: uuid("causation_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("outbox_events_tenant_id_idx").on(table.tenantId, table.id),
    index("outbox_events_pending_idx").on(table.publishedAt, table.availableAt, table.createdAt),
    index("outbox_events_aggregate_idx").on(
      table.tenantId,
      table.aggregateType,
      table.aggregateId,
      table.occurredAt,
    ),
    check("outbox_events_attempt_check", sql`${table.attempt} >= 0`),
    check("outbox_events_payload_json_check", sql`${table.payload} is json object`),
  ],
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    eventTypes: text("event_types").notNull().default("[]"),
    secretEncrypted: text("secret_encrypted").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("webhook_subscriptions_tenant_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("webhook_subscriptions_tenant_id_idx").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "webhook_subscriptions_creator_tenant_fk",
    }).onDelete("no action"),
    check(
      "webhook_subscriptions_status_check",
      sql`${table.status} in ('active','paused','disabled')`,
    ),
    check("webhook_subscriptions_event_types_json_check", sql`${table.eventTypes} is json array`),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").notNull(),
    eventId: uuid("event_id").notNull(),
    status: text("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseExcerpt: text("response_excerpt"),
    error: text("error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("webhook_deliveries_event_subscription_idx").on(
      table.tenantId,
      table.subscriptionId,
      table.eventId,
    ),
    index("webhook_deliveries_queue_idx").on(table.status, table.nextAttemptAt, table.createdAt),
    foreignKey({
      columns: [table.tenantId, table.subscriptionId],
      foreignColumns: [webhookSubscriptions.tenantId, webhookSubscriptions.id],
      name: "webhook_deliveries_subscription_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.eventId],
      foreignColumns: [outboxEvents.tenantId, outboxEvents.id],
      name: "webhook_deliveries_event_tenant_fk",
    }).onDelete("cascade"),
    check(
      "webhook_deliveries_status_check",
      sql`${table.status} in ('queued','delivering','delivered','retry','dead_letter')`,
    ),
  ],
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    configEncrypted: text("config_encrypted").notNull(),
    status: text("status").notNull().default("disabled"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("integration_connections_tenant_kind_name_idx")
      .on(table.tenantId, table.kind, table.name)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("integration_connections_tenant_id_idx").on(table.tenantId, table.id),
    check(
      "integration_connections_kind_check",
      sql`${table.kind} in ('sis','hr','finance','identity_oidc','identity_saml','identity_ldap','scim','signing','storage','antivirus','other')`,
    ),
    check(
      "integration_connections_status_check",
      sql`${table.status} in ('disabled','active','error')`,
    ),
  ],
);

/**
 * Application-owned SCIM bearer credentials.
 *
 * The raw bearer value is returned once by the control plane and is never
 * persisted. Better Auth's SCIM verifier resolves the SHA-256 digest at
 * request time and receives only an opaque connection id, credential id,
 * scopes and expiry. Keeping this catalog in the application domain lets the
 * existing tenant/RLS/audit controls own credential rotation without storing
 * a second copy of a high-value directory secret in `config_encrypted`.
 */
export const scimCredentials = pgTable(
  "scim_credentials",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    scopes: text("scopes").notNull().default("[]"),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedFromId: uuid("rotated_from_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scim_credentials_token_hash_idx").on(table.tokenHash),
    index("scim_credentials_connection_idx").on(
      table.tenantId,
      table.connectionId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.connectionId],
      foreignColumns: [integrationConnections.tenantId, integrationConnections.id],
      name: "scim_credentials_connection_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "scim_credentials_creator_tenant_fk",
    }).onDelete("no action"),
    check("scim_credentials_status_check", sql`${table.status} in ('active','revoked')`),
    check("scim_credentials_scopes_json_check", sql`${table.scopes} is json array`),
  ],
);

/** Durable external-system synchronization ledger. Core domain rows are not
 * overwritten by adapters: SIS/HR/LDAP pulls first land in a reviewable staging
 * projection, preserving an explicit reconciliation boundary. */
export const integrationSyncRuns = pgTable(
  "integration_sync_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    jobId: uuid("job_id"),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    received: integer("received").notNull().default(0),
    staged: integer("staged").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    publicError: text("public_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    requestedBy: text("requested_by").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("integration_sync_runs_tenant_id_idx").on(table.tenantId, table.id),
    index("integration_sync_runs_connection_idx").on(
      table.tenantId,
      table.connectionId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "integration_sync_runs_job_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.connectionId],
      foreignColumns: [integrationConnections.tenantId, integrationConnections.id],
      name: "integration_sync_runs_connection_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "integration_sync_runs_requester_tenant_fk",
    }).onDelete("no action"),
    check("integration_sync_runs_kind_check", sql`${table.kind} in ('sis','hr','identity_ldap')`),
    check(
      "integration_sync_runs_status_check",
      sql`${table.status} in ('queued','running','completed','failed')`,
    ),
  ],
);

export const integrationStagingRecords = pgTable(
  "integration_staging_records",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    runId: uuid("run_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    sourceKey: text("source_key").notNull(),
    entityType: text("entity_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull().default("pending"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("integration_staging_records_source_idx").on(
      table.tenantId,
      table.connectionId,
      table.sourceKey,
    ),
    index("integration_staging_records_run_idx").on(table.tenantId, table.runId, table.createdAt),
    check("integration_staging_payload_json_check", sql`${table.payloadJson} is json object`),
    foreignKey({
      columns: [table.tenantId, table.connectionId],
      foreignColumns: [integrationConnections.tenantId, integrationConnections.id],
      name: "integration_staging_connection_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.runId],
      foreignColumns: [integrationSyncRuns.tenantId, integrationSyncRuns.id],
      name: "integration_staging_run_tenant_fk",
    }).onDelete("cascade"),
    check(
      "integration_staging_status_check",
      sql`${table.status} in ('pending','applied','ignored','error')`,
    ),
  ],
);

/** Revocable bearer subscriptions for external calendar clients.
 * Only a SHA-256 token digest is persisted; permission is re-resolved from the
 * linked user on every feed request so role changes take effect immediately. */
export const calendarSubscriptionTokens = pgTable(
  "calendar_subscription_tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_subscription_tokens_hash_idx").on(table.tokenHash),
    index("calendar_subscription_tokens_user_idx").on(
      table.tenantId,
      table.userId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "calendar_subscription_tokens_user_tenant_fk",
    }).onDelete("cascade"),
  ],
);
