import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./core.ts";

/* ── Better Auth SCIM 1.7.3 plugin-owned runtime schema ─────────────────────
 * These model export names intentionally match @better-auth/scim exactly.
 * They remain outside tenant RLS because SCIM authentication and connection
 * resolution occur before an application tenant transaction exists. Tenant
 * authority is supplied by the application-owned, hashed SCIM credential
 * resolver and the plugin's connection/provisioning-domain keys. */
export const scimConnectionBinding = pgTable(
  "scim_connection_binding",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    connectionKey: text("connection_key").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    decommissionedAt: timestamp("decommissioned_at", { withTimezone: true }),
    decommissionStatus: text("decommission_status").notNull().default("active"),
    decommissionCursorUserId: text("decommission_cursor_user_id"),
    decommissionReconciledUserCount: integer("decommission_reconciled_user_count")
      .notNull()
      .default(0),
    decommissionBatchCount: integer("decommission_batch_count").notNull().default(0),
    decommissionRevision: integer("decommission_revision").notNull().default(0),
    decommissionCompletedAt: timestamp("decommission_completed_at", { withTimezone: true }),
    decommissionLeaseId: text("decommission_lease_id"),
    decommissionLeaseExpiresAt: timestamp("decommission_lease_expires_at", { withTimezone: true }),
  },
  (table) => [
    index("scim_connection_binding_connection_idx").on(table.connectionId),
    uniqueIndex("scim_connection_binding_key_idx").on(table.connectionKey),
  ],
);

export const scimIdentityTombstone = pgTable(
  "scim_identity_tombstone",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    externalId: text("external_id").notNull(),
    externalIdKey: text("external_id_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profile: text("profile").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("scim_identity_tombstone_connection_idx").on(table.connectionId),
    index("scim_identity_tombstone_domain_idx").on(table.provisioningDomainId),
    index("scim_identity_tombstone_user_idx").on(table.userId),
    uniqueIndex("scim_identity_tombstone_external_key_idx").on(table.externalIdKey),
  ],
);

export const scimSubject = pgTable(
  "scim_subject",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    profileSourceId: text("profile_source_id"),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("scim_subject_user_idx").on(table.userId),
    index("scim_subject_profile_source_idx").on(table.profileSourceId),
  ],
);

export const scimUser = pgTable(
  "scim_user",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    connectionUserKey: text("connection_user_key").notNull(),
    userName: text("user_name").notNull(),
    userNameKey: text("user_name_key").notNull(),
    primaryEmail: text("primary_email").notNull(),
    workEmailValueIndex: text("work_email_value_index").notNull(),
    emailValueIndex: text("email_value_index").notNull(),
    displayName: text("display_name").notNull(),
    formattedName: text("formatted_name").notNull(),
    givenName: text("given_name"),
    familyName: text("family_name"),
    serializedEmails: text("serialized_emails").notNull(),
    serializedAttributes: text("serialized_attributes"),
    externalId: text("external_id"),
    externalIdKey: text("external_id_key"),
    active: boolean("active").notNull(),
    orderKey: text("order_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("scim_user_connection_idx").on(table.connectionId),
    index("scim_user_domain_idx").on(table.provisioningDomainId),
    index("scim_user_user_idx").on(table.userId),
    uniqueIndex("scim_user_connection_user_key_idx").on(table.connectionUserKey),
    uniqueIndex("scim_user_name_key_idx").on(table.userNameKey),
    uniqueIndex("scim_user_external_key_idx").on(table.externalIdKey),
    uniqueIndex("scim_user_order_key_idx").on(table.orderKey),
  ],
);

export const scimProjectionGrant = pgTable(
  "scim_projection_grant",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    scimUserId: text("scim_user_id")
      .notNull()
      .references(() => scimUser.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    sourceValue: text("source_value"),
    role: text("role").notNull(),
    grantKey: text("grant_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("scim_projection_grant_connection_idx").on(table.connectionId),
    index("scim_projection_grant_domain_idx").on(table.provisioningDomainId),
    index("scim_projection_grant_scim_user_idx").on(table.scimUserId),
    index("scim_projection_grant_user_idx").on(table.userId),
    uniqueIndex("scim_projection_grant_key_idx").on(table.grantKey),
  ],
);

export const scimGroup = pgTable(
  "scim_group",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    provisioningDomainId: text("provisioning_domain_id").notNull(),
    revision: integer("revision").notNull().default(0),
    displayName: text("display_name").notNull(),
    displayNameKey: text("display_name_key").notNull(),
    externalId: text("external_id"),
    externalIdKey: text("external_id_key"),
    orderKey: text("order_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("scim_group_connection_idx").on(table.connectionId),
    index("scim_group_domain_idx").on(table.provisioningDomainId),
    uniqueIndex("scim_group_display_name_key_idx").on(table.displayNameKey),
    uniqueIndex("scim_group_external_key_idx").on(table.externalIdKey),
    uniqueIndex("scim_group_order_key_idx").on(table.orderKey),
  ],
);

export const scimGroupMember = pgTable(
  "scim_group_member",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => scimGroup.id, { onDelete: "cascade" }),
    scimUserId: text("scim_user_id")
      .notNull()
      .references(() => scimUser.id, { onDelete: "cascade" }),
    membershipKey: text("membership_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("scim_group_member_connection_idx").on(table.connectionId),
    index("scim_group_member_group_idx").on(table.groupId),
    index("scim_group_member_user_idx").on(table.scimUserId),
    uniqueIndex("scim_group_member_key_idx").on(table.membershipKey),
  ],
);
