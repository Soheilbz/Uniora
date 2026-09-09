import { queueExportFromRequest } from "@/lib/jobs/export-route.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return queueExportFromRequest(request, {
    kind: "workshops",
    capabilities: ["workshops.view", "data.export"],
    auditEntity: "workshop",
  });
}
