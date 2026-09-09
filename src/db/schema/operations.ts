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
import { timestamps } from "./fragments.ts";

/**
 * Shared durable job core for tenant-scoped background work.
 *
 * This unifies lifecycle mechanics (claim/lease/heartbeat/retry/dedupe/result)
 * without collapsing execution authority. `executionClass` is part of the
 * persisted contract: tenant workers and platform workers must still use
 * separate credentials and separate worker registries.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    executionClass: text("execution_class").notNull().default("tenant"),
    status: text("status").notNull().default("queued"),
    payload: text("payload").notNull().default("{}"),
    requestedBy: text("requested_by"),
    dedupeKey: text("dedupe_key"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    publicError: text("public_error"),
    privateError: text("private_error"),
    result: text("result"),
    correlationId: text("correlation_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("jobs_tenant_id_idx").on(table.tenantId, table.id),
    index("jobs_claim_idx").on(
      table.executionClass,
      table.status,
      table.scheduledAt,
      table.createdAt,
    ),
    index("jobs_lease_idx").on(table.executionClass, table.status, table.leaseUntil),
    index("jobs_requester_idx").on(table.tenantId, table.requestedBy, table.createdAt),
    uniqueIndex("jobs_active_dedupe_idx")
      .on(table.tenantId, table.kind, table.dedupeKey)
      .where(
        sql`${table.dedupeKey} is not null and ${table.status} in ('queued','running','retry')`,
      ),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "jobs_requester_tenant_fk",
    }).onDelete("restrict"),
    check("jobs_execution_class_check", sql`${table.executionClass} in ('tenant','platform')`),
    check(
      "jobs_status_check",
      sql`${table.status} in ('queued','running','retry','completed','failed','cancelled','expired')`,
    ),
    check("jobs_attempt_check", sql`${table.attempt} >= 0`),
    check("jobs_max_attempts_check", sql`${table.maxAttempts} between 1 and 20`),
    check("jobs_payload_json_check", sql`${table.payload} is json object`),
    check("jobs_result_json_check", sql`${table.result} is null or ${table.result} is json`),
  ],
);

export const jobAttempts = pgTable(
  "job_attempts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    attempt: integer("attempt").notNull(),
    workerId: text("worker_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outcome: text("outcome"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("job_attempts_job_attempt_idx").on(table.tenantId, table.jobId, table.attempt),
    index("job_attempts_job_idx").on(table.tenantId, table.jobId, table.startedAt),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "job_attempts_job_tenant_fk",
    }).onDelete("cascade"),
    check("job_attempts_attempt_check", sql`${table.attempt} > 0`),
    check(
      "job_attempts_outcome_check",
      sql`${table.outcome} is null or ${table.outcome} in ('completed','retry','failed','cancelled')`,
    ),
  ],
);
