import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { jobs } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { jobDedupeKey } from "@/lib/jobs/enqueue.ts";
import { parseExportArtifactResult } from "@/lib/jobs/export-artifact.ts";
import { stableJson } from "@/lib/stable-json.ts";

export const ACTIVE_EXPORT_JOB_LIMIT = 3;
export const ACTIVE_EXPORT_JOB_STATUSES = ["queued", "running", "retry"] as const;

export function isActiveExportJobStatus(status: string): boolean {
  return (ACTIVE_EXPORT_JOB_STATUSES as readonly string[]).includes(status);
}

export const EXPORT_JOB_KINDS = [
  "students",
  "professors",
  "council-meetings",
  "council-decisions",
  "workshops",
  "capacity",
  "reviewer-counts",
  "audit",
  "reports",
  "tenant-portability",
] as const;
export type ExportJobKind = (typeof EXPORT_JOB_KINDS)[number];

type ExportArtifactMetadata =
  | { state: "missing"; artifact: null }
  | { state: "valid"; artifact: ReturnType<typeof parseExportArtifactResult> }
  | { state: "corrupt"; artifact: null };

/**
 * Enqueue an export on the shared durable job core.
 *
 * Dedupe and the active-job cap remain user-scoped. The persisted job has the
 * generic lifecycle used by projections, scanning, scheduled work and webhook
 * delivery, while the worker registry keeps export execution under the tenant
 * worker credential rather than the platform-admin credential.
 */
export async function enqueueExportJob(input: {
  tenantId: string;
  userId: string;
  kind: ExportJobKind;
  parameters: Record<string, unknown>;
}): Promise<{ id: string; deduplicated: boolean }> {
  const payload = stableJson(input.parameters);
  const hash = jobDedupeKey(`export.${input.kind}`, input.parameters);
  return withTenant(input.tenantId, async (tx) => {
    await tx.execute(
      sql`select id from "user" where tenant_id=${input.tenantId} and id=${input.userId} for update`,
    );

    const [existing] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.tenantId, input.tenantId),
          eq(jobs.requestedBy, input.userId),
          eq(jobs.kind, `export.${input.kind}`),
          eq(jobs.dedupeKey, hash),
          inArray(jobs.status, ACTIVE_EXPORT_JOB_STATUSES),
        ),
      )
      .limit(1);
    if (existing) return { id: existing.id, deduplicated: true };

    const [active] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(jobs)
      .where(
        and(
          eq(jobs.tenantId, input.tenantId),
          eq(jobs.requestedBy, input.userId),
          like(jobs.kind, "export.%"),
          inArray(jobs.status, ACTIVE_EXPORT_JOB_STATUSES),
        ),
      );
    if ((active?.total ?? 0) >= ACTIVE_EXPORT_JOB_LIMIT) {
      throw new Error("EXPORT_JOB_LIMIT_REACHED");
    }

    const [created] = await tx
      .insert(jobs)
      .values({
        tenantId: input.tenantId,
        requestedBy: input.userId,
        kind: `export.${input.kind}`,
        executionClass: "tenant",
        payload,
        dedupeKey: hash,
        maxAttempts: 5,
      })
      .returning({ id: jobs.id });
    if (!created) throw new Error("failed to enqueue export job");
    return { id: created.id, deduplicated: false };
  });
}

function readArtifactMetadata(raw: string | null): ExportArtifactMetadata {
  if (!raw) return { state: "missing", artifact: null };
  try {
    return { state: "valid", artifact: parseExportArtifactResult(raw) };
  } catch {
    return { state: "corrupt", artifact: null };
  }
}

function publicKind(kind: string): ExportJobKind | null {
  if (!kind.startsWith("export.")) return null;
  const candidate = kind.slice("export.".length);
  return (EXPORT_JOB_KINDS as readonly string[]).includes(candidate)
    ? (candidate as ExportJobKind)
    : null;
}

export async function readOwnExportJobs(tenantId: string, userId: string, limit = 20) {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: jobs.id,
        kind: jobs.kind,
        status: jobs.status,
        result: jobs.result,
        publicError: jobs.publicError,
        createdAt: jobs.createdAt,
        completedAt: jobs.completedAt,
      })
      .from(jobs)
      .where(
        and(eq(jobs.tenantId, tenantId), eq(jobs.requestedBy, userId), like(jobs.kind, "export.%")),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(Math.min(Math.max(limit, 1), 50)),
  );

  return rows.flatMap((row) => {
    const kind = publicKind(row.kind);
    if (!kind) return [];
    const metadata = readArtifactMetadata(row.result);
    const artifact = metadata.artifact;
    const artifactMetadataInvalid = row.status === "completed" && metadata.state !== "valid";
    const artifactExpired =
      row.status === "completed" &&
      artifact !== null &&
      Date.parse(artifact.expiresAt) <= Date.now();
    return [
      {
        id: row.id,
        kind,
        status: artifactMetadataInvalid ? "failed" : artifactExpired ? "expired" : row.status,
        rowCount: artifact?.rowCount ?? null,
        errorMessage: row.publicError,
        metadataState: metadata.state,
        artifactMetadataInvalid,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        expiresAt: artifact ? new Date(artifact.expiresAt) : null,
      },
    ];
  });
}

export async function readOwnExportJob(tenantId: string, userId: string, id: string) {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.tenantId, tenantId),
          eq(jobs.requestedBy, userId),
          eq(jobs.id, id),
          like(jobs.kind, "export.%"),
        ),
      )
      .limit(1),
  );
  if (!row) return null;
  const kind = publicKind(row.kind);
  if (!kind) return null;
  const metadata = readArtifactMetadata(row.result);
  const artifact = metadata.artifact;
  return {
    ...row,
    kind,
    artifactPath: artifact?.artifactPath ?? null,
    artifactSha256: artifact?.artifactSha256 ?? null,
    rowCount: artifact?.rowCount ?? null,
    expiresAt: artifact ? new Date(artifact.expiresAt) : null,
    contentType: artifact?.contentType ?? null,
    filename: artifact?.filename ?? null,
    artifactSize: artifact?.size ?? null,
    metadataState: metadata.state,
    errorMessage: row.publicError,
  };
}
