"use server";

import { redirect } from "next/navigation";
import { auditDataExport } from "@/lib/export-audit.ts";
import { requireElevatedSession } from "@/lib/step-up.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { enqueueExportJob } from "@/modules/settings/export-jobs.ts";

export async function queueTenantPortabilityExport(): Promise<never> {
  const viewer = await requireCapability("data.export");
  if (!viewer.isTenantOwner) redirect("/settings/data?error=owner");
  await requireElevatedSession(viewer, "/settings/data");

  const job = await enqueueExportJob({
    tenantId: viewer.tenantId,
    userId: viewer.userId,
    kind: "tenant-portability",
    parameters: {
      applicationVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.8.2",
    },
  });
  await auditDataExport(viewer, "tenant", {
    jobId: job.id,
    deduplicated: job.deduplicated,
    schemaVersion: 2,
  });
  redirect(`/settings/data?job=${job.id}`);
}
