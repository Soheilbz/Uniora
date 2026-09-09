import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { lookups } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

export interface LookupSetView {
  set: string;
  total: number;
  retired: number;
}

export interface LookupEntryView {
  id: string;
  set: string;
  value: string;
  label: string;
  position: number;
  retired: boolean;
}

/** Read-only lookup data. Kept out of the action module so tenantId is never
 * exposed as a client-callable Server Action argument. */
export async function readLookupSets(tenantId: string): Promise<LookupSetView[]> {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        set: lookups.set,
        total: sql<number>`count(*)`.mapWith(Number),
        retired: sql<number>`count(*) filter (where ${lookups.retiredAt} is not null)`.mapWith(
          Number,
        ),
      })
      .from(lookups)
      .groupBy(lookups.set)
      .orderBy(asc(lookups.set)),
  );
}

export async function readLookupEntries(tenantId: string, set: string): Promise<LookupEntryView[]> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: lookups.id,
        set: lookups.set,
        value: lookups.value,
        label: lookups.label,
        position: lookups.position,
        retiredAt: lookups.retiredAt,
      })
      .from(lookups)
      .where(eq(lookups.set, set))
      .orderBy(asc(lookups.position), asc(lookups.label)),
  );

  return rows.map(({ retiredAt, ...row }) => ({ ...row, retired: retiredAt !== null }));
}

export async function offeredCount(tenantId: string, set: string): Promise<number> {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(lookups)
      .where(and(eq(lookups.set, set), isNull(lookups.retiredAt))),
  );
  return row?.total ?? 0;
}
