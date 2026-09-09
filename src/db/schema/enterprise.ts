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
import { councilDecisions } from "./council.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { jobs } from "./operations.ts";
import { professors, students } from "./registry.ts";
import { workshopParticipants, workshops } from "./workshops.ts";

/** Immutable transition ledger for the explicit council state machine. */
export const councilDecisionTransitions = pgTable(
  "council_decision_transitions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    reason: text("reason"),
    actorId: text("actor_id").notNull(),
    correlationId: text("correlation_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    index("council_transition_decision_idx").on(table.tenantId, table.decisionId, table.occurredAt),
    foreignKey({
      columns: [table.tenantId, table.decisionId],
      foreignColumns: [councilDecisions.tenantId, councilDecisions.id],
      name: "council_transition_decision_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.actorId],
      foreignColumns: [user.tenantId, user.id],
      name: "council_transition_actor_tenant_fk",
    }).onDelete("no action"),
  ],
);

/** Saved, tenant-owned column mappings for repeatable imports. */
export const importMappingProfiles = pgTable(
  "import_mapping_profiles",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    mappingJson: text("mapping_json").notNull().default("{}"),
    matchStrategyJson: text("match_strategy_json").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("import_mapping_profiles_tenant_entity_name_idx")
      .on(table.tenantId, table.entityType, table.name)
      .where(sql`${table.deletedAt} is null`),
    check("import_mapping_profiles_mapping_json_check", sql`${table.mappingJson} is json object`),
    check(
      "import_mapping_profiles_match_strategy_json_check",
      sql`${table.matchStrategyJson} is json object`,
    ),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "import_mapping_profiles_creator_tenant_fk",
    }).onDelete("no action"),
  ],
);

/** Object-storage backed, resumable participant import ledger. */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    workshopId: uuid("workshop_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mappingJson: text("mapping_json").notNull().default("{}"),
    conflictPolicy: text("conflict_policy").notNull().default("skip"),
    status: text("status").notNull().default("uploading"),
    jobId: uuid("job_id"),
    processedRows: integer("processed_rows").notNull().default(0),
    totalRows: integer("total_rows"),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    faultCount: integer("fault_count").notNull().default(0),
    faultsJson: text("faults_json").notNull().default("[]"),
    publicError: text("public_error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("import_batches_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
    check("import_batches_mapping_json_check", sql`${table.mappingJson} is json object`),
    check("import_batches_faults_json_check", sql`${table.faultsJson} is json array`),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "import_batches_job_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.workshopId],
      foreignColumns: [workshops.tenantId, workshops.id],
      name: "import_batches_workshop_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "import_batches_requester_tenant_fk",
    }).onDelete("no action"),
    check(
      "import_batches_status_check",
      sql`${table.status} in ('uploading','queued','running','completed','failed','expired','cancelled')`,
    ),
    check("import_batches_conflict_check", sql`${table.conflictPolicy} in ('skip','update')`),
    check("import_batches_size_check", sql`${table.sizeBytes} between 1 and 104857600`),
  ],
);

/** Public registrations remain tenant-owned and are exposed only via narrow DB functions. */
export const workshopRegistrations = pgTable(
  "workshop_registrations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    workshopId: uuid("workshop_id").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    externalReference: text("external_reference"),
    /** Stable per-workshop identity fingerprint used only to make public submits idempotent. */
    identityKey: text("identity_key"),
    /** Created when an administrator approves the request. */
    participantId: uuid("participant_id"),
    status: text("status").notNull().default("pending"),
    source: text("source").notNull().default("public"),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("workshop_registrations_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("workshop_registrations_active_identity_idx")
      .on(table.tenantId, table.workshopId, table.identityKey)
      .where(
        sql`${table.deletedAt} is null and ${table.identityKey} is not null and ${table.status} in ('pending','approved','attended')`,
      ),
    uniqueIndex("workshop_registrations_participant_idx")
      .on(table.tenantId, table.participantId)
      .where(sql`${table.participantId} is not null`),
    index("workshop_registrations_workshop_status_idx").on(
      table.tenantId,
      table.workshopId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.workshopId],
      foreignColumns: [workshops.tenantId, workshops.id],
      name: "workshop_registrations_workshop_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "workshop_registrations_approver_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.participantId],
      foreignColumns: [workshopParticipants.tenantId, workshopParticipants.id],
      name: "workshop_registrations_participant_tenant_fk",
    }).onDelete("no action"),
    check(
      "workshop_registrations_status_check",
      sql`${table.status} in ('pending','approved','rejected','cancelled','attended')`,
    ),
    check(
      "workshop_registrations_source_check",
      sql`${table.source} in ('public','staff','integration')`,
    ),
  ],
);

/** Links authenticated portal identities to domain records without overloading the domain tables. */
export const portalLinks = pgTable(
  "portal_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    subjectType: text("subject_type").notNull(),
    studentId: uuid("student_id"),
    professorId: uuid("professor_id"),
    status: text("status").notNull().default("active"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("portal_links_tenant_user_subject_idx")
      .on(table.tenantId, table.userId, table.subjectType)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "portal_links_user_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.studentId],
      foreignColumns: [students.tenantId, students.id],
      name: "portal_links_student_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.professorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "portal_links_professor_tenant_fk",
    }).onDelete("cascade"),
    check("portal_links_subject_type_check", sql`${table.subjectType} in ('student','professor')`),
    check("portal_links_status_check", sql`${table.status} in ('active','suspended','revoked')`),
    check(
      "portal_links_subject_check",
      sql`(${table.subjectType}='student' and ${table.studentId} is not null and ${table.professorId} is null) or (${table.subjectType}='professor' and ${table.professorId} is not null and ${table.studentId} is null)`,
    ),
  ],
);

/** Better Auth SSO provider runtime storage.
 *
 * The application's encrypted integration catalog remains the administrative
 * source of truth. Active OIDC/SAML connections are materialized into this
 * plugin-owned table so the audited Better Auth implementation can execute
 * discovery, callbacks and SAML verification. Disabled connections are removed
 * from this runtime table while the encrypted control-plane configuration stays
 * intact. */
export const ssoProvider = pgTable(
  "sso_provider",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    domain: text("domain").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    providerId: text("provider_id").notNull(),
    organizationId: text("organization_id"),
  },
  (table) => [
    uniqueIndex("sso_provider_provider_id_idx").on(table.providerId),
    index("sso_provider_user_idx").on(table.userId),
    index("sso_provider_domain_idx").on(table.domain),
  ],
);

/** Explicitly provisioned external identities.
 *
 * Never link SSO identities by e-mail. The protocol authority + immutable
 * subject must be provisioned by an administrator (or a reviewed directory
 * synchronization) before Better Auth may link the external account. */
export const externalIdentityLinks = pgTable(
  "external_identity_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    connectionId: uuid("connection_id").notNull(),
    providerId: text("provider_id").notNull(),
    protocol: text("protocol").notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("active"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("external_identity_links_subject_idx")
      .on(table.providerId, table.issuer, table.subject)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("external_identity_links_user_provider_idx")
      .on(table.tenantId, table.userId, table.providerId)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "external_identity_links_user_tenant_fk",
    }).onDelete("cascade"),
    check(
      "external_identity_links_protocol_check",
      sql`${table.protocol} in ('oidc','saml','scim')`,
    ),
    check("external_identity_links_status_check", sql`${table.status} in ('active','disabled')`),
  ],
);

/**
 * Better Auth Passkey plugin storage.
 *
 * Keep this table aligned with Better Auth's published `passkey` model instead
 * of maintaining a parallel WebAuthn credential store. User ids are globally
 * unique in the authentication domain, so tenant ownership is derived through
 * the user row rather than duplicated as a required plugin column.
 */
export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    aaguid: text("aaguid"),
  },
  (table) => [
    uniqueIndex("passkey_credential_idx").on(table.credentialID),
    index("passkey_user_idx").on(table.userId, table.createdAt),
    check("passkey_counter_check", sql`${table.counter} >= 0`),
  ],
);

/** Fixed-window API quota state. One row per service account and window. */
export const apiRateWindows = pgTable(
  "api_rate_windows",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    serviceAccountId: uuid("service_account_id").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("api_rate_windows_account_window_idx").on(
      table.tenantId,
      table.serviceAccountId,
      table.windowStartedAt,
    ),
    check("api_rate_windows_count_check", sql`${table.requestCount} >= 0`),
  ],
);

/** Generic, versioned analytics projection for dashboard-heavy deployments. */
export const reportingSnapshots = pgTable(
  "reporting_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    projection: text("projection").notNull(),
    periodKey: text("period_key").notNull().default("current"),
    payloadJson: text("payload_json").notNull().default("{}"),
    sourceMaxUpdatedAt: timestamp("source_max_updated_at", { withTimezone: true }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reporting_snapshots_projection_idx").on(
      table.tenantId,
      table.projection,
      table.periodKey,
    ),
    index("reporting_snapshots_time_idx").on(table.tenantId, table.calculatedAt),
    check("reporting_snapshots_payload_json_check", sql`${table.payloadJson} is json object`),
  ],
);
