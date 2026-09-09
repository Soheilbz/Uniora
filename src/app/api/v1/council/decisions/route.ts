import { and, asc, gt, isNull } from "drizzle-orm";
import { councilDecisions } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import {
  apiCursor,
  apiJson,
  authenticateServiceRequest,
  boundedApiLimit,
} from "@/lib/api/service-auth.ts";

export async function GET(request: Request) {
  const principal = await authenticateServiceRequest(request, ["council.view"]);
  if (principal instanceof Response) return principal;

  const url = new URL(request.url);
  const limit = boundedApiLimit(url);
  const cursor = apiCursor(url);
  if (cursor instanceof Response) return cursor;
  const rows = await readOnly(principal.tenantId, (tx) =>
    tx
      .select({
        id: councilDecisions.id,
        meetingNumber: councilDecisions.meetingNumber,
        meetingDate: councilDecisions.meetingDate,
        studentNumber: councilDecisions.studentNumber,
        studentName: councilDecisions.studentName,
        thesisTitle: councilDecisions.thesisTitle,
        reviewStatus: councilDecisions.reviewStatus,
        workflowState: councilDecisions.workflowState,
        decisionText: councilDecisions.decisionText,
        updatedAt: councilDecisions.updatedAt,
      })
      .from(councilDecisions)
      .where(
        and(
          isNull(councilDecisions.deletedAt),
          cursor ? gt(councilDecisions.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(councilDecisions.id))
      .limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return apiJson({ data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null });
}
