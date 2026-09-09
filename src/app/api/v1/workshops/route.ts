import { and, asc, gt, isNull } from "drizzle-orm";
import { workshops } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import {
  apiCursor,
  apiJson,
  authenticateServiceRequest,
  boundedApiLimit,
} from "@/lib/api/service-auth.ts";

export async function GET(request: Request) {
  const principal = await authenticateServiceRequest(request, ["workshops.view"]);
  if (principal instanceof Response) return principal;

  const url = new URL(request.url);
  const limit = boundedApiLimit(url);
  const cursor = apiCursor(url);
  if (cursor instanceof Response) return cursor;
  const rows = await readOnly(principal.tenantId, (tx) =>
    tx
      .select({
        id: workshops.id,
        title: workshops.title,
        workshopDate: workshops.workshopDate,
        durationHours: workshops.durationHours,
        locationType: workshops.locationType,
        venue: workshops.venue,
        capacity: workshops.capacity,
        status: workshops.status,
        updatedAt: workshops.updatedAt,
      })
      .from(workshops)
      .where(and(isNull(workshops.deletedAt), cursor ? gt(workshops.id, cursor) : undefined))
      .orderBy(asc(workshops.id))
      .limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return apiJson({ data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null });
}
