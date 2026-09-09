import { and, asc, gt, isNull } from "drizzle-orm";
import { students } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import {
  apiCursor,
  apiJson,
  authenticateServiceRequest,
  boundedApiLimit,
} from "@/lib/api/service-auth.ts";

export async function GET(request: Request) {
  const principal = await authenticateServiceRequest(request, ["students.view"]);
  if (principal instanceof Response) return principal;

  const url = new URL(request.url);
  const limit = boundedApiLimit(url);
  const cursor = apiCursor(url);
  if (cursor instanceof Response) return cursor;
  const sensitive =
    principal.capabilities.includes("students.sensitive.read") ||
    principal.capabilities.includes("students.nationality");

  const rows = await readOnly(principal.tenantId, (tx) =>
    tx
      .select({
        id: students.id,
        studentNumber: students.studentNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        ...(sensitive ? { nationalId: students.nationalId } : {}),
        degree: students.degree,
        fieldOfStudy: students.fieldOfStudy,
        faculty: students.faculty,
        department: students.department,
        status: students.status,
        updatedAt: students.updatedAt,
      })
      .from(students)
      .where(and(isNull(students.deletedAt), cursor ? gt(students.id, cursor) : undefined))
      .orderBy(asc(students.id))
      .limit(limit + 1),
  );

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return apiJson({ data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null });
}
