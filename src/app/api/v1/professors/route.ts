import { and, asc, gt, isNull } from "drizzle-orm";
import { professors } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import {
  apiCursor,
  apiJson,
  authenticateServiceRequest,
  boundedApiLimit,
} from "@/lib/api/service-auth.ts";

export async function GET(request: Request) {
  const principal = await authenticateServiceRequest(request, ["professors.view"]);
  if (principal instanceof Response) return principal;

  const url = new URL(request.url);
  const limit = boundedApiLimit(url);
  const cursor = apiCursor(url);
  if (cursor instanceof Response) return cursor;
  const bank = principal.capabilities.includes("professors.bank.read");

  const rows = await readOnly(principal.tenantId, (tx) =>
    tx
      .select({
        id: professors.id,
        professorCode: professors.professorCode,
        firstName: professors.firstName,
        lastName: professors.lastName,
        academicRank: professors.academicRank,
        faculty: professors.faculty,
        department: professors.department,
        specialization: professors.specialization,
        ...(bank ? { bankAccountNumber: professors.bankAccountNumber } : {}),
        updatedAt: professors.updatedAt,
      })
      .from(professors)
      .where(and(isNull(professors.deletedAt), cursor ? gt(professors.id, cursor) : undefined))
      .orderBy(asc(professors.id))
      .limit(limit + 1),
  );

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return apiJson({ data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null });
}
