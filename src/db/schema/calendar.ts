import { sql } from "drizzle-orm";
import { date, foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenants, user } from "./core.ts";
import { concurrency, retirement, timestamps } from "./fragments.ts";

/**
 * The office's own entries on the calendar. Other calendar items are read-only
 * projections of the register that owns them, so this table is the only one
 * edited from the calendar surface.
 */
export const calendarEntries = pgTable(
  "calendar_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    notes: text("notes"),
    entryDate: date("entry_date").notNull(),
    /** `HH:mm`, or null for an all-day entry. */
    startTime: text("start_time"),
    endTime: text("end_time"),
    /** Kept after access revocation so the author remains auditable. */
    authorId: text("author_id"),
    ...concurrency,
    ...timestamps,
    ...retirement,
  },
  (table) => [
    index("calendar_tenant_date_idx").on(table.tenantId, table.entryDate),
    foreignKey({
      columns: [table.tenantId, table.authorId],
      foreignColumns: [user.tenantId, user.id],
      name: "calendar_author_tenant_fk",
    }).onDelete("no action"),
  ],
);
