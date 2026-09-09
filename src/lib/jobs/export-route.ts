import { applicationOrigin } from "@/lib/application-origin.ts";
import type { Capability } from "@/lib/capabilities.ts";
import { auditDataExport } from "@/lib/export-audit.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { type ExportJobKind, enqueueExportJob } from "@/modules/settings/export-jobs.ts";

/**
 * Common HTTP adapter for durable exports.
 *
 * Every export now snapshots in the background worker. The browser request only
 * authenticates, captures the exact query string and enqueues the work, so large
 * registers never hold an HTTP response or a database snapshot open.
 */
export async function queueExportFromRequest(
  request: Request,
  input: {
    kind: ExportJobKind;
    capabilities: readonly Capability[];
    auditEntity: string;
    extra?: (viewer: Awaited<ReturnType<typeof requireCapability>>) => Record<string, unknown>;
  },
) {
  const viewer = await requireCapability(...input.capabilities);
  const url = new URL(request.url);
  const parameters: Record<string, unknown> = {
    query: Object.fromEntries(url.searchParams.entries()),
    ...input.extra?.(viewer),
  };
  const job = await enqueueExportJob({
    tenantId: viewer.tenantId,
    userId: viewer.userId,
    kind: input.kind,
    parameters,
  });
  await auditDataExport(viewer, input.auditEntity, {
    mode: "background-request",
    jobId: job.id,
    deduplicated: job.deduplicated,
  });
  return Response.redirect(new URL(`/settings/data?job=${job.id}`, applicationOrigin()), 303);
}
