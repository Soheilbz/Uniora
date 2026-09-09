import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { auditDataExport } from "@/lib/export-audit.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readOwnExportJob } from "@/modules/settings/export-jobs.ts";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("data.export");
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const job = await readOwnExportJob(viewer.tenantId, viewer.userId, id);
  if (!job) return new Response("Not found", { status: 404 });
  if (job.kind === "tenant-portability" && !viewer.isTenantOwner)
    return new Response("Forbidden", { status: 403 });
  if (job.status === "completed" && job.metadataState !== "valid") {
    return new Response("Export metadata is unavailable", { status: 500 });
  }
  if (job.status !== "completed" || !job.artifactPath || !job.artifactSha256 || !job.expiresAt) {
    return new Response("Export is not ready", { status: 409 });
  }
  if (job.expiresAt <= new Date()) return new Response("Export expired", { status: 410 });

  const root = resolve(
    /* turbopackIgnore: true */ process.env.EXPORT_JOB_DIR?.trim() || "./exports",
  );
  const file = resolve(root, job.artifactPath);
  if (dirname(file) !== root || !existsSync(/* turbopackIgnore: true */ file))
    return new Response("Export artifact is unavailable", { status: 410 });
  if (
    job.artifactSize === null ||
    statSync(/* turbopackIgnore: true */ file).size !== job.artifactSize
  )
    return new Response("Export integrity check failed", { status: 500 });
  if ((await sha256(file)) !== job.artifactSha256)
    return new Response("Export integrity check failed", { status: 500 });

  await auditDataExport(viewer, job.kind === "tenant-portability" ? "tenant" : job.kind, {
    mode: "background-download",
    jobId: job.id,
    rowCount: job.rowCount,
  });
  const filename =
    job.filename ?? `${job.kind}-${job.id}.${job.kind === "tenant-portability" ? "json" : "csv"}`;
  const stream = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ file),
  ) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type":
        job.contentType ??
        (job.kind === "tenant-portability"
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8"),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(job.artifactSize),
    },
  });
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
