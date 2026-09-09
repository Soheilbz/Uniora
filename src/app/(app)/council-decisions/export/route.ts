import { queueExportFromRequest } from "@/lib/jobs/export-route.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return queueExportFromRequest(request, {
    kind: "council-decisions",
    capabilities: ["council.view", "data.export"],
    auditEntity: "council-decision",
  });
}
