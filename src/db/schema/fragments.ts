import { integer, timestamp } from "drizzle-orm/pg-core";

/** Common timestamp columns for mutable records. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Soft-retirement marker used where historical references must remain valid. */
export const retirement = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/** Optimistic-concurrency generation carried by editable institutional rows. */
export const concurrency = {
  version: integer("version").notNull().default(1),
};
