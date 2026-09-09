import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./core.ts";
import { timestamps } from "./fragments.ts";

/**
 * Accounts that operate the installation itself rather than one university.
 *
 * This table is intentionally outside the tenant role model. A platform
 * operator may see the tenant registry and its administrators, but does not
 * become a member of any university and therefore cannot accidentally inherit
 * tenant data through an ordinary role assignment.
 */
export const platformOperators = pgTable("platform_operators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
});

/**
 * Cross-tenant operations requested by the platform console.
 *
 * The Web role may only enqueue and read these rows. A separate operations
 * worker, started with the privileged database environment, performs the
 * actual provisioning/lifecycle change and writes the result back.
 */
export const platformOperationRequests = pgTable(
  "platform_operation_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("queued"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    targetSlug: text("target_slug").generatedAlwaysAs(sql`nullif(payload->>'slug', '')`),
    targetUsername: text("target_username").generatedAlwaysAs(
      sql`nullif(payload->>'username', '')`,
    ),
    targetName: text("target_name").generatedAlwaysAs(
      sql`nullif(coalesce(payload->>'name', payload->>'adminName'), '')`,
    ),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("platform_operation_requests_queue_idx").on(table.status, table.createdAt),
    index("platform_operation_requests_target_slug_idx").using(
      "gin",
      table.targetSlug.op("gin_trgm_ops"),
    ),
    index("platform_operation_requests_target_username_idx").using(
      "gin",
      table.targetUsername.op("gin_trgm_ops"),
    ),
    index("platform_operation_requests_target_name_idx").using(
      "gin",
      table.targetName.op("gin_trgm_ops"),
    ),
    check(
      "platform_operation_requests_kind_check",
      sql`${table.kind} in ('tenant.create','tenant.rename','tenant.suspend','tenant.resume','tenant.archive','tenant.failed.purge','tenant.owner.set','tenant.user.create','tenant.user.password.reset','backup.create','backup.verify','break-glass.start','break-glass.end','platform.operation.retry','platform.operation.cancel')`,
    ),
    check(
      "platform_operation_requests_status_check",
      sql`${table.status} in ('queued','running','completed','failed','cancelled')`,
    ),
  ],
);
