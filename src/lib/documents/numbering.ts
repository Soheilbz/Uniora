import { and, eq, sql } from "drizzle-orm";
import { documentSequences } from "@/db/schema.ts";
import type { TenantTx } from "@/db/tenant.ts";

/** Allocates an official number under a transaction-scoped advisory lock. */
export async function allocateDocumentNumber(
  tx: TenantTx,
  input: { tenantId: string; documentType: string; year: number; prefix?: string; format?: string },
): Promise<string> {
  if (!Number.isInteger(input.year) || input.year < 1200 || input.year > 3000)
    throw new Error("invalid sequence year");
  const type = input.documentType.trim();
  if (!type) throw new Error("document type is required");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${type}:${input.year}`}, 0))`,
  );
  let [row] = await tx
    .select()
    .from(documentSequences)
    .where(
      and(
        eq(documentSequences.tenantId, input.tenantId),
        eq(documentSequences.documentType, type),
        eq(documentSequences.year, input.year),
      ),
    )
    .limit(1);
  if (!row) {
    [row] = await tx
      .insert(documentSequences)
      .values({
        tenantId: input.tenantId,
        documentType: type,
        year: input.year,
        prefix: input.prefix?.trim() ?? "",
        format: input.format?.trim() || "{prefix}{year}/{number}",
        nextNumber: 1,
      })
      .returning();
  }
  if (!row) throw new Error("failed to initialise document sequence");
  const number = row.nextNumber ?? 1;
  await tx
    .update(documentSequences)
    .set({ nextNumber: number + 1, updatedAt: new Date() })
    .where(and(eq(documentSequences.tenantId, input.tenantId), eq(documentSequences.id, row.id)));
  return render(row.format, {
    prefix: row.prefix,
    year: String(input.year),
    number: String(number),
  });
}

function render(format: string, values: Record<string, string>): string {
  const number = values.number ?? "";
  return format
    .replace(/\{number:(\d{1,2})\}/g, (_, width: string) =>
      number.padStart(Math.min(Math.max(Number(width), 1), 12), "0"),
    )
    .replace(/\{(prefix|year|number)\}/g, (_, key: string) =>
      key === "number" ? number.padStart(4, "0") : (values[key] ?? ""),
    )
    .replace(/\/{2,}/g, "/")
    .trim();
}
