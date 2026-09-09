import { and, eq, isNull, sql } from "drizzle-orm";
import {
  academicPeriods,
  academicPrograms,
  academicYears,
  organizationUnits,
  organizationUnitVersions,
} from "@/db/schema.ts";
import { type TenantTx, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";

const YEAR_STATUSES = new Set(["planned", "active", "closed"]);
const PERIOD_KINDS = new Set(["semester", "summer", "annual", "custom"]);
const PERIOD_STATUSES = new Set(["planned", "active", "closed"]);
const UNIT_TYPES = new Set([
  "university",
  "faculty",
  "department",
  "center",
  "institute",
  "office",
  "other",
]);
const UNIT_STATUSES = new Set(["active", "inactive", "merged", "closed"]);
const PROGRAM_STATUSES = new Set(["active", "inactive", "retired"]);

function field(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? "")
    .trim()
    .slice(0, max);
}

function isoDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function optionalIsoDate(value: string): string | null {
  return value ? isoDate(value) : null;
}

function safeVersion(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function parentName(tx: TenantTx, parentId: string | null): Promise<string | null> {
  if (!parentId) return null;
  const [parent] = await tx
    .select({ name: organizationUnits.name })
    .from(organizationUnits)
    .where(and(eq(organizationUnits.id, parentId), isNull(organizationUnits.deletedAt)))
    .limit(1);
  return parent?.name ?? null;
}

export async function createAcademicYearUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const code = field(form, "code", 80);
  const label = field(form, "label", 160);
  const startsOn = isoDate(field(form, "startsOn", 10));
  const endsOn = isoDate(field(form, "endsOn", 10));
  const status = field(form, "status", 20) || "planned";
  if (!code || !label || !startsOn || !endsOn || endsOn < startsOn || !YEAR_STATUSES.has(status))
    return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [created] = await tx
      .insert(academicYears)
      .values({
        tenantId: viewer.tenantId,
        code,
        label,
        startsOn,
        endsOn,
        status,
      })
      .returning({ id: academicYears.id });
    if (!created) throw new Error("failed to create academic year");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "master_data.academic_year.create",
      entityType: "academic_year",
      entityId: created.id,
      changes: JSON.stringify({ code, label, startsOn, endsOn, status }),
    });
  });
}

export async function createAcademicPeriodUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const academicYearId = field(form, "academicYearId", 36);
  const code = field(form, "code", 80);
  const label = field(form, "label", 160);
  const kind = field(form, "kind", 20) || "semester";
  const startsOn = isoDate(field(form, "startsOn", 10));
  const endsOn = isoDate(field(form, "endsOn", 10));
  const position = Number(field(form, "position", 8) || "0");
  const status = field(form, "status", 20) || "planned";
  if (
    !academicYearId ||
    !code ||
    !label ||
    !startsOn ||
    !endsOn ||
    endsOn < startsOn ||
    !PERIOD_KINDS.has(kind) ||
    !PERIOD_STATUSES.has(status) ||
    !Number.isSafeInteger(position) ||
    position < 0
  )
    return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [year] = await tx
      .select({ startsOn: academicYears.startsOn, endsOn: academicYears.endsOn })
      .from(academicYears)
      .where(and(eq(academicYears.id, academicYearId), isNull(academicYears.deletedAt)))
      .limit(1);
    if (!year || startsOn < year.startsOn || endsOn > year.endsOn) return;

    const [created] = await tx
      .insert(academicPeriods)
      .values({
        tenantId: viewer.tenantId,
        academicYearId,
        code,
        label,
        kind,
        startsOn,
        endsOn,
        position,
        status,
      })
      .returning({ id: academicPeriods.id });
    if (!created) throw new Error("failed to create academic period");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "master_data.academic_period.create",
      entityType: "academic_period",
      entityId: created.id,
      changes: JSON.stringify({
        academicYearId,
        code,
        label,
        kind,
        startsOn,
        endsOn,
        position,
        status,
      }),
    });
  });
}

export async function createOrganizationUnitUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const parentId = field(form, "parentId", 36) || null;
  const type = field(form, "type", 30);
  const code = field(form, "code", 80);
  const name = field(form, "name", 300);
  const nameEn = field(form, "nameEn", 300) || null;
  const validFrom = isoDate(field(form, "validFrom", 10));
  const validTo = optionalIsoDate(field(form, "validTo", 10));
  const status = field(form, "status", 20) || "active";
  if (!type || !code || !name || !validFrom || !UNIT_TYPES.has(type) || !UNIT_STATUSES.has(status))
    return;
  if (validTo && validTo < validFrom) return;

  await withTenant(viewer.tenantId, async (tx) => {
    const parent = parentId
      ? await tx
          .select({ id: organizationUnits.id, name: organizationUnits.name })
          .from(organizationUnits)
          .where(and(eq(organizationUnits.id, parentId), isNull(organizationUnits.deletedAt)))
          .limit(1)
      : [];
    if (parentId && !parent[0]) return;

    const [created] = await tx
      .insert(organizationUnits)
      .values({
        tenantId: viewer.tenantId,
        parentId,
        type,
        code,
        name,
        nameEn,
        validFrom,
        validTo,
        status,
      })
      .returning({ id: organizationUnits.id });
    if (!created) throw new Error("failed to create organization unit");

    await tx.insert(organizationUnitVersions).values({
      tenantId: viewer.tenantId,
      organizationUnitId: created.id,
      versionNo: 1,
      codeSnapshot: code,
      nameSnapshot: name,
      parentNameSnapshot: parent[0]?.name ?? null,
      validFrom,
      validTo,
      reason: "created",
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "master_data.organization_unit.create",
      entityType: "organization_unit",
      entityId: created.id,
      changes: JSON.stringify({ parentId, type, code, name, nameEn, validFrom, validTo, status }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "OrganizationUnitCreated",
      aggregateType: "organization_unit",
      aggregateId: created.id,
      payload: { type, code, name },
    });
  });
}

export async function updateOrganizationUnitUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const id = field(form, "id", 36);
  const version = safeVersion(field(form, "version", 12));
  const name = field(form, "name", 300);
  const nameEn = field(form, "nameEn", 300) || null;
  const validTo = optionalIsoDate(field(form, "validTo", 10));
  const status = field(form, "status", 20);
  const reason = field(form, "reason", 500) || "administrative update";
  if (!id || !version || !name || !UNIT_STATUSES.has(status)) return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [current] = await tx
      .select()
      .from(organizationUnits)
      .where(and(eq(organizationUnits.id, id), isNull(organizationUnits.deletedAt)))
      .limit(1);
    if (!current || current.version !== version || (validTo && validTo < current.validFrom)) return;

    const changed = await tx
      .update(organizationUnits)
      .set({
        name,
        nameEn,
        validTo,
        status,
        version: sql`${organizationUnits.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(organizationUnits.id, id), eq(organizationUnits.version, version)))
      .returning({ id: organizationUnits.id });
    if (!changed[0]) return;

    const [last] = await tx
      .select({ versionNo: organizationUnitVersions.versionNo })
      .from(organizationUnitVersions)
      .where(eq(organizationUnitVersions.organizationUnitId, id))
      .orderBy(sql`${organizationUnitVersions.versionNo} desc`)
      .limit(1);
    const parentSnapshot = await parentName(tx, current.parentId);
    await tx.insert(organizationUnitVersions).values({
      tenantId: viewer.tenantId,
      organizationUnitId: id,
      versionNo: (last?.versionNo ?? 0) + 1,
      codeSnapshot: current.code,
      nameSnapshot: name,
      parentNameSnapshot: parentSnapshot,
      validFrom: current.validFrom,
      validTo,
      reason,
    });
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "master_data.organization_unit.update",
      entityType: "organization_unit",
      entityId: id,
      changes: JSON.stringify({
        name: { from: current.name, to: name },
        nameEn: { from: current.nameEn, to: nameEn },
        validTo: { from: current.validTo, to: validTo },
        status: { from: current.status, to: status },
        reason,
      }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "OrganizationUnitChanged",
      aggregateType: "organization_unit",
      aggregateId: id,
      payload: { name, status, reason },
    });
  });
}

export async function createAcademicProgramUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const departmentId = field(form, "departmentId", 36);
  const code = field(form, "code", 80);
  const name = field(form, "name", 300);
  const degreeLevel = field(form, "degreeLevel", 120);
  const fieldOfStudy = field(form, "field", 300);
  const orientation = field(form, "orientation", 300) || null;
  const validFrom = isoDate(field(form, "validFrom", 10));
  const validTo = optionalIsoDate(field(form, "validTo", 10));
  const status = field(form, "status", 20) || "active";
  if (
    !departmentId ||
    !code ||
    !name ||
    !degreeLevel ||
    !fieldOfStudy ||
    !validFrom ||
    !PROGRAM_STATUSES.has(status)
  )
    return;
  if (validTo && validTo < validFrom) return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [department] = await tx
      .select({ id: organizationUnits.id, type: organizationUnits.type })
      .from(organizationUnits)
      .where(and(eq(organizationUnits.id, departmentId), isNull(organizationUnits.deletedAt)))
      .limit(1);
    if (department?.type !== "department") return;

    const [created] = await tx
      .insert(academicPrograms)
      .values({
        tenantId: viewer.tenantId,
        departmentId,
        code,
        name,
        degreeLevel,
        field: fieldOfStudy,
        orientation,
        validFrom,
        validTo,
        status,
      })
      .returning({ id: academicPrograms.id });
    if (!created) throw new Error("failed to create academic program");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "master_data.academic_program.create",
      entityType: "academic_program",
      entityId: created.id,
      changes: JSON.stringify({
        departmentId,
        code,
        name,
        degreeLevel,
        field: fieldOfStudy,
        orientation,
        validFrom,
        validTo,
        status,
      }),
    });
  });
}

export async function updateMasterDataStatusUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const kind = field(form, "kind", 40);
  const id = field(form, "id", 36);
  const version = safeVersion(field(form, "version", 12));
  const status = field(form, "status", 30);
  if (!id || !version) return;

  await withTenant(viewer.tenantId, async (tx) => {
    let changed = false;
    if (kind === "academic_year" && YEAR_STATUSES.has(status)) {
      const rows = await tx
        .update(academicYears)
        .set({ status, version: sql`${academicYears.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(academicYears.id, id),
            eq(academicYears.version, version),
            isNull(academicYears.deletedAt),
          ),
        )
        .returning({ id: academicYears.id });
      changed = rows.length > 0;
    } else if (kind === "academic_period" && PERIOD_STATUSES.has(status)) {
      const rows = await tx
        .update(academicPeriods)
        .set({ status, version: sql`${academicPeriods.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(academicPeriods.id, id),
            eq(academicPeriods.version, version),
            isNull(academicPeriods.deletedAt),
          ),
        )
        .returning({ id: academicPeriods.id });
      changed = rows.length > 0;
    } else if (kind === "academic_program" && PROGRAM_STATUSES.has(status)) {
      const rows = await tx
        .update(academicPrograms)
        .set({ status, version: sql`${academicPrograms.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(academicPrograms.id, id),
            eq(academicPrograms.version, version),
            isNull(academicPrograms.deletedAt),
          ),
        )
        .returning({ id: academicPrograms.id });
      changed = rows.length > 0;
    } else {
      return;
    }
    if (!changed) return;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "master_data.status.update",
      entityType: kind,
      entityId: id,
      changes: JSON.stringify({ status }),
    });
  });
}
