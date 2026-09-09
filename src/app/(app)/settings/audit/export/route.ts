import { queueExportFromRequest } from "@/lib/jobs/export-route.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return queueExportFromRequest(request, {
    kind: "audit",
    capabilities: ["audit.view", "data.export"],
    auditEntity: "audit",
  });
}
