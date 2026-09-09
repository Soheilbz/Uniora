import { and, eq, isNull, sql } from "drizzle-orm";
import { professors, researchProjects } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";

const STATUSES = new Set(["draft", "proposed", "approved", "active", "completed", "cancelled"]);
const TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(["proposed", "cancelled"]),
  proposed: new Set(["draft", "approved", "cancelled"]),
  approved: new Set(["active", "cancelled"]),
  active: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
};

function field(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? "")
    .trim()
    .slice(0, max);
}

function isoDateOrNull(value: string): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function budgetOrNull(value: string): string | null {
  if (!value) return null;
  if (!/^\d{1,18}(?:\.\d{1,2})?$/.test(value)) return null;
  return value;
}

export async function createResearchProjectUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const projectCode = field(form, "projectCode", 120);
  const title = field(form, "title", 1000);
  const principalInvestigatorId = field(form, "principalInvestigatorId", 36);
  if (!projectCode || !title || !principalInvestigatorId) return;
  const startsOn = isoDateOrNull(field(form, "startsOn", 10));
  const endsOn = isoDateOrNull(field(form, "endsOn", 10));
  if (startsOn && endsOn && endsOn < startsOn) return;

  const budget = budgetOrNull(field(form, "budget", 24));
  const currency = field(form, "currency", 12).toUpperCase() || "IRR";
  const fundingSource = field(form, "fundingSource", 500) || null;

  await withTenant(viewer.tenantId, async (tx) => {
    const [pi] = await tx
      .select({ id: professors.id, firstName: professors.firstName, lastName: professors.lastName })
      .from(professors)
      .where(and(eq(professors.id, principalInvestigatorId), isNull(professors.deletedAt)))
      .limit(1);
    if (!pi) return;
    const principalInvestigatorSnapshot = `${pi.firstName} ${pi.lastName}`.trim();

    const [created] = await tx
      .insert(researchProjects)
      .values({
        tenantId: viewer.tenantId,
        projectCode,
        title,
        principalInvestigatorId: pi.id,
        principalInvestigatorSnapshot,
        budget,
        currency,
        fundingSource,
        startsOn,
        endsOn,
        status: "draft",
      })
      .returning({ id: researchProjects.id });
    if (!created) throw new Error("failed to create research project");

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "research_project.create",
      entityType: "research_project",
      entityId: created.id,
      changes: JSON.stringify({
        projectCode,
        title,
        principalInvestigatorId: pi.id,
        budget,
        currency,
        fundingSource,
        startsOn,
        endsOn,
      }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "ResearchProjectCreated",
      aggregateType: "research_project",
      aggregateId: created.id,
      payload: { projectCode, principalInvestigatorId: pi.id },
    });
  });
}

export async function transitionResearchProjectUseCase(
  viewer: Viewer,
  form: FormData,
): Promise<void> {
  const id = field(form, "id", 36);
  const version = Number(field(form, "version", 12));
  const next = field(form, "status", 30);
  if (!id || !Number.isSafeInteger(version) || !STATUSES.has(next)) return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [current] = await tx
      .select({ status: researchProjects.status })
      .from(researchProjects)
      .where(and(eq(researchProjects.id, id), isNull(researchProjects.deletedAt)))
      .limit(1);
    if (!current || current.status === next) return;
    if (!(TRANSITIONS[current.status] ?? new Set()).has(next)) return;

    const changed = await tx
      .update(researchProjects)
      .set({ status: next, updatedAt: new Date(), version: sql`${researchProjects.version} + 1` })
      .where(and(eq(researchProjects.id, id), eq(researchProjects.version, version)))
      .returning({ id: researchProjects.id });
    if (changed.length === 0) return;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "research_project.transition",
      entityType: "research_project",
      entityId: id,
      changes: JSON.stringify({ status: { from: current.status, to: next } }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "ResearchProjectStatusChanged",
      aggregateType: "research_project",
      aggregateId: id,
      payload: { from: current.status, to: next },
    });
  });
}
