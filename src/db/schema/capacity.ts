import { sql } from "drizzle-orm";
import { foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { roles, tenants, user } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";
import { professors } from "./registry.ts";

/* ── Supervision capacity ─────────────────────────────────────────────────── */

/**
 * What a professor is *allowed* to supervise, in one intake year.
 *
 * The quota, not the load. The load is computed from the student register —
 * nothing writes it down — and this is the figure it is measured against: the
 * faculty sets it per professor per year, and the capacity screen puts the two
 * side by side.
 *
 * ── Two quotas, measuring different things ──────────────────────────────────
 *
 * **Concurrent** is how many students a professor may be supervising at one
 * time, so every enrolled student they hold is charged against it. **Annual** is
 * how many they may take on in a single intake, so only that year's admissions
 * count. A professor at their concurrent ceiling may still have annual room, and
 * conflating the two is how a faculty either blocks an appointment it meant to
 * allow or allows one it meant to block.
 *
 * ── Three funding streams ───────────────────────────────────────────────────
 *
 * `total` is the faculty's own allocation. `campus` and `external` are the
 * self-funded campus and the international intake, which are allocated
 * separately and do not draw on it. They are separate columns rather than a
 * `stream` column with three rows because the office's own form has three
 * columns and a professor always has all three — modelled as rows, every screen
 * would have to cope with a professor who has two of them.
 */
/**
 * A register's search, filters and sort, saved under a name.
 *
 * ── Why a query string and not a structured column ──────────────────────────
 *
 * Every register in this product keeps its whole state in the address — that is
 * the design, and it is what makes «the doctoral students of this faculty who
 * have not defended» a link somebody can send. So a saved view is exactly that
 * address's query, stored verbatim.
 *
 * The alternative — columns for search, for each filter, for the sort — has to
 * be extended every time a register gains a filter, and a view saved before the
 * change silently loses the part the schema had no column for. `readQuery`
 * already refuses anything it does not recognise, so a stale key in a stored
 * query is dropped on read rather than trusted.
 *
 * ── Why it belongs to a person and not a device ─────────────────────────────
 *
 * Saved views are server-side account data so they are available consistently
 * across browsers and sessions.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    /* Cascades: a view is a personal preference and has no meaning without the
       person. Unlike an audit row, nothing later needs to name its owner. */
    userId: text("user_id").notNull(),

    /** The register's base path — `/students`, `/council-meetings`. */
    register: text("register").notNull(),
    name: text("name").notNull(),
    /** The address's query, without the leading `?`. Empty means «unnarrowed». */
    query: text("query").notNull().default(""),
    /** Private by default; publication never grants data access. */
    scope: text("scope").notNull().default("private"),
    publishedBy: text("published_by"),
    /** Role-based audience when scope is `team`; null for private or tenant-wide views. */
    audienceRoleId: uuid("audience_role_id"),

    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "saved_views_user_tenant_fk",
    }).onDelete("cascade"),
    uniqueIndex("saved_views_tenant_id_idx").on(table.tenantId, table.id),
    index("saved_views_owner_idx").on(table.tenantId, table.userId, table.register),
    index("saved_views_audience_idx").on(
      table.tenantId,
      table.register,
      table.scope,
      table.audienceRoleId,
    ),
    foreignKey({
      columns: [table.tenantId, table.audienceRoleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: "saved_views_audience_role_tenant_fk",
    }).onDelete("cascade"),
    /*
     * One name per register per person.
     *
     * Saving over an existing name is a *correction* — somebody refining the
     * view they already had — so the action updates rather than inserting, and
     * this is what makes that the only possible outcome.
     */
    uniqueIndex("saved_views_name_idx").on(
      table.tenantId,
      table.userId,
      table.register,
      table.name,
    ),
  ],
);

export const professorCapacities = pgTable(
  "professor_capacities",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    professorId: uuid("professor_id").notNull(),
    /** The Jalali intake year the quota is set for — ۱۴۰۴. */
    year: integer("year").notNull(),
    /** Versioned calculation authority used for reproducible historical results. */
    regulationVersionId: uuid("regulation_version_id"),
    academicYearId: uuid("academic_year_id"),

    doctorateConcurrentTotal: integer("doctorate_concurrent_total").notNull().default(0),
    doctorateAnnualTotal: integer("doctorate_annual_total").notNull().default(0),
    mastersConcurrentTotal: integer("masters_concurrent_total").notNull().default(0),
    mastersAnnualTotal: integer("masters_annual_total").notNull().default(0),

    doctorateConcurrentCampus: integer("doctorate_concurrent_campus").notNull().default(0),
    doctorateAnnualCampus: integer("doctorate_annual_campus").notNull().default(0),
    mastersConcurrentCampus: integer("masters_concurrent_campus").notNull().default(0),
    mastersAnnualCampus: integer("masters_annual_campus").notNull().default(0),

    doctorateConcurrentExternal: integer("doctorate_concurrent_external").notNull().default(0),
    doctorateAnnualExternal: integer("doctorate_annual_external").notNull().default(0),
    mastersConcurrentExternal: integer("masters_concurrent_external").notNull().default(0),
    mastersAnnualExternal: integer("masters_annual_external").notNull().default(0),

    notes: text("notes"),

    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    /*
     * One quota row per professor per year. Partial, so a row entered twice and
     * retired once does not block the year being set again — which happens when
     * a clerk corrects a mis-keyed year.
     */
    uniqueIndex("professor_capacities_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("capacities_tenant_professor_year_idx")
      .on(table.tenantId, table.professorId, table.year)
      .where(sql`deleted_at is null`),
    index("capacities_tenant_year_idx").on(table.tenantId, table.year),
    foreignKey({
      columns: [table.tenantId, table.professorId],
      foreignColumns: [professors.tenantId, professors.id],
      name: "capacities_professor_tenant_fk",
    }).onDelete("cascade"),
  ],
);
