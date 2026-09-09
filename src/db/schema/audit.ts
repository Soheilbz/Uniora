import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, user } from "./core.ts";

const appSchema = pgSchema("app");

/* ── Audit ────────────────────────────────────────────────────────────────── */

/**
 * Who changed what, kept because an institutional registry is answerable.
 *
 * Append-only by policy — see the migration, which grants INSERT and SELECT and
 * withholds UPDATE and DELETE from the application role. An audit trail the
 * application can rewrite is not an audit trail.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    actorId: text("actor_id"),
    /** Optional affected identity when the actor is anonymous or acts on another user. */
    subjectId: text("subject_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** The fields that changed, as `{ field: { from, to } }`. */
    changes: text("changes"),
    outcome: text("outcome").notNull().default("success"),
    source: text("source").notNull().default("web"),
    requestId: text("request_id"),
    sessionId: text("session_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Folded searchable event text; actor-name search is resolved separately. */
    searchText: text("search_text").generatedAlwaysAs(
      sql`app.fold_text(
        coalesce(entity_id, '') || ' ' ||
        coalesce(action, '') || ' ' ||
        coalesce(entity_type, '') || ' ' ||
        coalesce(subject_id, '') || ' ' ||
        coalesce(request_id, '') || ' ' ||
        coalesce(changes, '')
      )`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.actorId],
      foreignColumns: [user.tenantId, user.id],
      name: "audit_actor_tenant_fk",
    }).onDelete("no action"),
    index("audit_tenant_time_idx").on(table.tenantId, sql`created_at desc`),
    index("audit_tenant_time_id_idx").on(table.tenantId, sql`created_at desc`, sql`id desc`),
    index("audit_search_idx").using("gin", table.searchText.op("gin_trgm_ops")),
    index("audit_entity_idx").on(table.tenantId, table.entityType, table.entityId),
  ],
);

/** Platform operations are deliberately outside tenant RLS and are writable only
 * by provisioning/operations credentials, never by the web application role. */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    operator: text("operator").notNull(),
    action: text("action").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    target: text("target"),
    changes: text("changes"),
    outcome: text("outcome").notNull().default("success"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_audit_time_idx").on(sql`created_at desc`),
    index("platform_audit_time_id_idx").on(sql`created_at desc`, sql`id desc`),
    index("platform_audit_operator_search_idx").using("gin", table.operator.op("gin_trgm_ops")),
    index("platform_audit_action_search_idx").using("gin", table.action.op("gin_trgm_ops")),
    index("platform_audit_target_search_idx").using("gin", table.target.op("gin_trgm_ops")),
    index("platform_audit_request_search_idx").using("gin", table.requestId.op("gin_trgm_ops")),
  ],
);

/**
 * A deliberately narrow read surface for the platform console. The Web role
 * must not receive direct table privileges on the append-only audit store;
 * this view is the only projection it may query.
 */
export const platformAuditExplorer = appSchema
  .view("platform_audit_explorer", {
    id: uuid("id").notNull(),
    operator: text("operator").notNull(),
    action: text("action").notNull(),
    tenantId: uuid("tenant_id"),
    target: text("target"),
    changes: text("changes"),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  })
  .existing();

/** Sanitized operator-published health facts. The Web role has SELECT only;
 * privileged operational jobs are the sole writers. No secrets, paths, keys or
 * database credentials may be stored in payloadJson. */
export const platformOperationalHealth = pgTable(
  "platform_operational_health",
  {
    key: text("key").primaryKey(),
    status: text("status").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_operational_health_observed_idx").on(table.observedAt),
    check(
      "platform_operational_health_payload_json_check",
      sql`${table.payloadJson} is json object`,
    ),
  ],
);

/** Runtime liveness and coarse operational counters for long-running workers.
 * The tenant worker owns only these rows plus the queue/attempt ledgers; the
 * request-serving Web role receives read-only access for platform diagnostics.
 * Payloads must stay low-cardinality and contain no tenant identifiers or PII. */
export const workerRuntimeHealth = pgTable(
  "worker_runtime_health",
  {
    workerId: text("worker_id").primaryKey(),
    executionClass: text("execution_class").notNull(),
    status: text("status").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("worker_runtime_health_class_observed_idx").on(table.executionClass, table.observedAt),
    check(
      "worker_runtime_health_execution_class_check",
      sql`${table.executionClass} in ('tenant','platform')`,
    ),
    check(
      "worker_runtime_health_status_check",
      sql`${table.status} in ('ok','degraded','stopping')`,
    ),
    check("worker_runtime_health_payload_json_check", sql`${table.payloadJson} is json object`),
  ],
);
