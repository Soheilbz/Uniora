import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client.ts";
import {
  breakGlassSessions,
  councilDecisions,
  institutions,
  jobs,
  professors,
  qualityRules,
  qualitySnapshots,
  students,
  tasks,
  tenantFeatures,
  tenants,
  workshops,
} from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { requirePlatformElevatedSession } from "@/lib/platform-viewer.ts";

export interface BreakGlassSummary {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  tenantNotifiedAt: Date | null;
}

export async function readPlatformBreakGlassSessions(
  operatorId: string,
): Promise<BreakGlassSummary[]> {
  const tenantRows = await db()
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants);
  const results: BreakGlassSummary[] = [];
  for (const tenant of tenantRows) {
    const rows = await readOnly(
      tenant.id,
      (tx) =>
        tx
          .select({
            id: breakGlassSessions.id,
            reason: breakGlassSessions.reason,
            startsAt: breakGlassSessions.startsAt,
            expiresAt: breakGlassSessions.expiresAt,
            tenantNotifiedAt: breakGlassSessions.tenantNotifiedAt,
          })
          .from(breakGlassSessions)
          .where(
            and(
              eq(breakGlassSessions.platformOperatorId, operatorId),
              eq(breakGlassSessions.status, "active"),
              gt(breakGlassSessions.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(breakGlassSessions.expiresAt)),
      { allowInactive: true },
    );
    for (const row of rows)
      results.push({
        ...row,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
      });
  }
  return results.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

export async function requireBreakGlassAccess(tenantId: string) {
  const nextPath = `/platform/support/${tenantId}`;
  const operator = await requirePlatformElevatedSession(nextPath);
  const [active] = await readOnly(
    tenantId,
    (tx) =>
      tx
        .select({
          id: breakGlassSessions.id,
          reason: breakGlassSessions.reason,
          expiresAt: breakGlassSessions.expiresAt,
        })
        .from(breakGlassSessions)
        .where(
          and(
            eq(breakGlassSessions.platformOperatorId, operator.userId),
            eq(breakGlassSessions.platformSessionId, operator.sessionId),
            eq(breakGlassSessions.status, "active"),
            gt(breakGlassSessions.expiresAt, new Date()),
          ),
        )
        .limit(1),
    { allowInactive: true },
  );
  if (!active) redirect("/platform?error=breakGlassRequired");

  await withTenant(
    tenantId,
    async (tx) => {
      await writeAuditEvent(tx, {
        tenantId,
        actorId: null,
        subjectId: operator.userId,
        action: "platform.break_glass.access",
        entityType: "tenant_support",
        entityId: tenantId,
        changes: JSON.stringify({
          breakGlassId: active.id,
          operator: operator.username,
          expiresAt: active.expiresAt.toISOString(),
        }),
        source: "platform-support",
      });
    },
    { allowInactive: true },
  );
  return { operator, session: active };
}

export async function readBreakGlassSupportOverview(tenantId: string) {
  return readOnly(
    tenantId,
    async (tx) => {
      const institution = await tx
        .select({
          name: institutions.name,
          faculty: institutions.faculty,
          timezone: institutions.timezone,
        })
        .from(institutions)
        .limit(1);
      const studentCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(isNull(students.deletedAt));
      const professorCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(professors)
        .where(isNull(professors.deletedAt));
      const decisionCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(councilDecisions)
        .where(isNull(councilDecisions.deletedAt));
      const workshopCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(workshops)
        .where(isNull(workshops.deletedAt));
      const taskCount = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(isNull(tasks.deletedAt), sql`${tasks.status} not in ('completed','cancelled')`));
      const failedJobs = await tx
        .select({
          id: jobs.id,
          kind: jobs.kind,
          publicError: jobs.publicError,
          completedAt: jobs.completedAt,
          attempt: jobs.attempt,
        })
        .from(jobs)
        .where(eq(jobs.status, "failed"))
        .orderBy(desc(jobs.completedAt))
        .limit(20);
      const quality = await tx
        .select({
          code: qualityRules.code,
          severity: qualityRules.severity,
          count: qualitySnapshots.count,
          capturedAt: qualitySnapshots.capturedAt,
        })
        .from(qualitySnapshots)
        .innerJoin(
          qualityRules,
          and(
            eq(qualityRules.tenantId, qualitySnapshots.tenantId),
            eq(qualityRules.id, qualitySnapshots.ruleId),
          ),
        )
        .orderBy(desc(qualitySnapshots.capturedAt))
        .limit(20);
      const features = await tx
        .select({ key: tenantFeatures.feature, enabled: tenantFeatures.enabled })
        .from(tenantFeatures)
        .orderBy(tenantFeatures.feature);
      return {
        institution: institution[0] ?? null,
        counts: {
          students: Number(studentCount[0]?.count ?? 0),
          professors: Number(professorCount[0]?.count ?? 0),
          decisions: Number(decisionCount[0]?.count ?? 0),
          workshops: Number(workshopCount[0]?.count ?? 0),
          openTasks: Number(taskCount[0]?.count ?? 0),
        },
        failedJobs,
        quality,
        features,
      };
    },
    { allowInactive: true },
  );
}
