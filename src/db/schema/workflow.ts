import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, user } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    assignedTo: text("assigned_to"),
    assignedRoleId: uuid("assigned_role_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    createdBy: text("created_by").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    sourceEventId: uuid("source_event_id"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("tasks_tenant_id_idx").on(table.tenantId, table.id),
    index("tasks_assignee_status_due_idx").on(
      table.tenantId,
      table.assignedTo,
      table.status,
      table.dueAt,
    ),
    index("tasks_entity_idx").on(table.tenantId, table.entityType, table.entityId),
    foreignKey({
      columns: [table.tenantId, table.assignedTo],
      foreignColumns: [user.tenantId, user.id],
      name: "tasks_assignee_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "tasks_creator_tenant_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [table.tenantId, table.completedBy],
      foreignColumns: [user.tenantId, user.id],
      name: "tasks_completer_tenant_fk",
    }).onDelete("no action"),
    check("tasks_priority_check", sql`${table.priority} in ('low','normal','high','critical')`),
    check(
      "tasks_status_check",
      sql`${table.status} in ('open','in_progress','blocked','completed','cancelled')`,
    ),
  ],
);

export const taskTransitions = pgTable(
  "task_transitions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").notNull(),
    actorId: text("actor_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("task_transitions_task_idx").on(table.tenantId, table.taskId, table.createdAt),
    foreignKey({
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
      name: "task_transitions_task_tenant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.actorId],
      foreignColumns: [user.tenantId, user.id],
      name: "task_transitions_actor_tenant_fk",
    }).onDelete("no action"),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    severity: text("severity").notNull().default("info"),
    sourceEventId: uuid("source_event_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("notifications_user_unread_idx").on(
      table.tenantId,
      table.userId,
      table.readAt,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "notifications_user_tenant_fk",
    }).onDelete("cascade"),
    check(
      "notifications_severity_check",
      sql`${table.severity} in ('info','success','warning','error')`,
    ),
  ],
);

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    schedule: text("schedule").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    payload: text("payload").notNull().default("{}"),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("scheduled_jobs_tenant_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.deletedAt} is null`),
    index("scheduled_jobs_due_idx").on(table.enabled, table.nextRunAt),
    check("scheduled_jobs_payload_json_check", sql`${table.payload} is json object`),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [user.tenantId, user.id],
      name: "scheduled_jobs_creator_tenant_fk",
    }).onDelete("no action"),
  ],
);
