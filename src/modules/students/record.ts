import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { students } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

/**
 * One student's whole record, and the lists a form needs to edit it.
 */

export type StudentRecord = typeof students.$inferSelect;

/**
 * The record, or nothing.
 *
 * `null` rather than a thrown error for a record that is not there, because
 * "not there" has three causes that must be indistinguishable to the caller: the
 * id does not exist, the record is retired, or it belongs to another
 * institution. The third is the important one — row-level security makes that
 * row invisible rather than forbidden, and the page must render the same "not
 * found" for all three. A distinct "you may not see this" would confirm that a
 * student with that id exists somewhere, which is precisely what the boundary
 * exists to withhold.
 */
export const readStudent = cache(
  async (tenantId: string, id: string): Promise<StudentRecord | null> => {
    const [record] = await readOnly(tenantId, (tx) =>
      tx
        .select()
        .from(students)
        .where(and(eq(students.id, id), isNull(students.deletedAt)))
        .limit(1),
    );
    return record ?? null;
  },
);
