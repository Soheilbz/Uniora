import { queueExportFromRequest } from "@/lib/jobs/export-route.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return queueExportFromRequest(request, {
    kind: "reviewer-counts",
    capabilities: ["council.view", "professors.view", "data.export"],
    auditEntity: "reviewer-count",
  });
}
