import { queueExportFromRequest } from "@/lib/jobs/export-route.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return queueExportFromRequest(request, {
    kind: "professors",
    capabilities: ["professors.view", "data.export"],
    auditEntity: "professor",
    extra: (viewer) => ({ includeBank: viewer.capabilities.includes("professors.bank.read") }),
  });
}
