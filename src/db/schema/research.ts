import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { professors } from "./registry.ts";

export const researchProjects = pgTable(
  "research_projects",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    projectCode: text("project_code").notNull(),
    title: text("title").notNull(),
    principalInvestigatorId: uuid("principal_investigator_id"),
    principalInvestigatorSnapshot: text("principal_investigator_snapshot").notNull(),
    collaboratorsJson: text("collaborators_json").notNull().default("[]"),
    budget: numeric("budget", { precision: 20, scale: 2 }),
    currency: text("currency").notNull().default("IRR"),
    fundingSource: text("funding_source"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    status: text("status").notNull().default("draft"),
    councilDecisionId: uuid("council_decision_id"),
    outputsJson: text("outputs_json").notNull().default("[]"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    uniqueIndex("research_projects_tenant_code_idx")
      .on(table.tenantId, table.projectCode)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("research_projects_tenant_id_idx").on(table.tenantId, table.id),
    index("research_projects_status_idx").on(table.tenantId, table.status, table.startsOn),
    foreignKey({
      columns: [table.tenantId, table.principalInvestigatorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "research_projects_pi_tenant_fk",
    }).onDelete("no action"),
    check(
      "research_projects_status_check",
      sql`${table.status} in ('draft','proposed','approved','active','completed','cancelled')`,
    ),
    check(
      "research_projects_dates_check",
      sql`${table.endsOn} is null or ${table.startsOn} is null or ${table.endsOn} >= ${table.startsOn}`,
    ),
    check(
      "research_projects_collaborators_json_check",
      sql`${table.collaboratorsJson} is json array`,
    ),
    check("research_projects_outputs_json_check", sql`${table.outputsJson} is json array`),
  ],
);
