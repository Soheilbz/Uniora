import { queueExportFromRequest } from "@/lib/jobs/export-route.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return queueExportFromRequest(request, {
    kind: "students",
    capabilities: ["students.view", "data.export"],
    auditEntity: "student",
    extra: (viewer) => ({
      includeNationalId:
        viewer.capabilities.includes("students.sensitive.read") ||
        viewer.capabilities.includes("students.nationality"),
    }),
  });
}
