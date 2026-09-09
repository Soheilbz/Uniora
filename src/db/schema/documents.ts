import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  type PgTableWithColumns,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, user } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";

/** Metadata only. File bytes live behind the object-storage abstraction. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    uploadedBy: text("uploaded_by").notNull(),
    classification: text("classification").notNull().default("internal"),
    status: text("status").notNull().default("quarantine"),
    version: integer("version").notNull().default(1),
    scanProvider: text("scan_provider"),
    scanResult: text("scan_result"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }),
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("attachments_tenant_object_key_idx").on(table.tenantId, table.objectKey),
    uniqueIndex("attachments_tenant_id_idx").on(table.tenantId, table.id),
    index("attachments_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.uploadedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "attachments_uploader_tenant_fk",
    }).onDelete("no action"),
    check("attachments_size_check", sql`${table.sizeBytes} >= 0`),
    check(
      "attachments_classification_check",
      sql`${table.classification} in ('public','internal','confidential','restricted')`,
    ),
    check(
      "attachments_status_check",
      sql`${table.status} in ('quarantine','scanning','available','rejected','superseded','deleted')`,
    ),
  ],
);

// biome-ignore lint/suspicious/noExplicitAny: Drizzle needs an explicit recursive table shape for the version self-reference.
export const documentVersions: PgTableWithColumns<any> = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    documentType: text("document_type").notNull(),
    documentId: text("document_id").notNull(),
    versionNo: integer("version_no").notNull(),
    attachmentId: uuid("attachment_id"),
    contentSha256: text("content_sha256").notNull(),
    status: text("status").notNull().default("draft"),
    supersedesVersionId: uuid("supersedes_version_id"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: text("finalized_by"),
    finalizationReason: text("finalization_reason"),
    signatureProvider: text("signature_provider"),
    signatureReference: text("signature_reference"),
    ...timestamps,
  },
  // biome-ignore lint/suspicious/noExplicitAny: The callback references documentVersions while its table shape is being initialized.
  (table): any => [
    uniqueIndex("document_versions_tenant_doc_version_idx").on(
      table.tenantId,
      table.documentType,
      table.documentId,
      table.versionNo,
    ),
    uniqueIndex("document_versions_tenant_id_idx").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.attachmentId],
      foreignColumns: [attachments.tenantId, attachments.id],
      name: "document_versions_attachment_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supersedesVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.id],
      name: "document_versions_supersedes_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.finalizedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "document_versions_finalizer_tenant_fk",
    }).onDelete("no action"),
    check("document_versions_version_check", sql`${table.versionNo} > 0`),
    check(
      "document_versions_status_check",
      sql`${table.status} in ('draft','finalized','superseded','void')`,
    ),
  ],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    documentType: text("document_type").notNull(),
    year: integer("year").notNull(),
    prefix: text("prefix").notNull().default(""),
    nextNumber: integer("next_number").notNull().default(1),
    format: text("format").notNull().default("{prefix}{year}/{number}"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("document_sequences_tenant_type_year_idx").on(
      table.tenantId,
      table.documentType,
      table.year,
    ),
    check("document_sequences_next_number_check", sql`${table.nextNumber} > 0`),
  ],
);

export const correspondence = pgTable(
  "correspondence",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    direction: text("direction").notNull(),
    number: text("number"),
    subject: text("subject").notNull(),
    body: text("body"),
    sender: text("sender"),
    receivedOn: date("received_on"),
    sentOn: date("sent_on"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    classification: text("classification").notNull().default("internal"),
    createdBy: text("created_by").notNull(),
    finalizedVersionId: uuid("finalized_version_id"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("correspondence_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("correspondence_tenant_number_idx")
      .on(table.tenantId, table.number)
      .where(sql`${table.number} is not null and ${table.deletedAt} is null`),
    index("correspondence_status_due_idx").on(table.tenantId, table.status, table.dueAt),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "correspondence_creator_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.finalizedVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.id],
      name: "correspondence_final_version_tenant_fk",
    }).onDelete("restrict"),
    check(
      "correspondence_direction_check",
      sql`${table.direction} in ('incoming','outgoing','internal')`,
    ),
    check(
      "correspondence_status_check",
      sql`${table.status} in ('draft','registered','referred','closed','cancelled')`,
    ),
    check(
      "correspondence_classification_check",
      sql`${table.classification} in ('public','internal','confidential','restricted')`,
    ),
  ],
);

export const correspondenceRecipients = pgTable(
  "correspondence_recipients",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    correspondenceId: uuid("correspondence_id").notNull(),
    recipientType: text("recipient_type").notNull().default("text"),
    recipientId: text("recipient_id"),
    recipientLabel: text("recipient_label").notNull(),
    role: text("role").notNull().default("to"),
    ...timestamps,
  },
  (table) => [
    index("correspondence_recipients_message_idx").on(table.tenantId, table.correspondenceId),
    foreignKey({
      columns: [table.tenantId, table.correspondenceId],
      foreignColumns: [correspondence.tenantId, correspondence.id],
      name: "correspondence_recipients_message_tenant_fk",
    }).onDelete("cascade"),
    check(
      "correspondence_recipient_role_check",
      sql`${table.role} in ('to','cc','bcc','referral')`,
    ),
  ],
);
