import { and, asc, eq, isNull } from "drizzle-orm";
import {
  academicPeriods,
  academicPrograms,
  academicYears,
  organizationUnits,
  organizationUnitVersions,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

export async function readMasterData(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    const years = await tx
      .select()
      .from(academicYears)
      .where(isNull(academicYears.deletedAt))
      .orderBy(asc(academicYears.startsOn), asc(academicYears.code));
    const periods = await tx
      .select({
        id: academicPeriods.id,
        academicYearId: academicPeriods.academicYearId,
        academicYearLabel: academicYears.label,
        code: academicPeriods.code,
        label: academicPeriods.label,
        kind: academicPeriods.kind,
        startsOn: academicPeriods.startsOn,
        endsOn: academicPeriods.endsOn,
        position: academicPeriods.position,
        status: academicPeriods.status,
        version: academicPeriods.version,
      })
      .from(academicPeriods)
      .innerJoin(
        academicYears,
        and(eq(academicYears.id, academicPeriods.academicYearId), isNull(academicYears.deletedAt)),
      )
      .where(isNull(academicPeriods.deletedAt))
      .orderBy(asc(academicPeriods.startsOn), asc(academicPeriods.position));
    const units = await tx
      .select({
        id: organizationUnits.id,
        parentId: organizationUnits.parentId,
        type: organizationUnits.type,
        code: organizationUnits.code,
        name: organizationUnits.name,
        nameEn: organizationUnits.nameEn,
        validFrom: organizationUnits.validFrom,
        validTo: organizationUnits.validTo,
        status: organizationUnits.status,
        version: organizationUnits.version,
      })
      .from(organizationUnits)
      .where(isNull(organizationUnits.deletedAt))
      .orderBy(asc(organizationUnits.type), asc(organizationUnits.name));
    const programs = await tx
      .select({
        id: academicPrograms.id,
        departmentId: academicPrograms.departmentId,
        code: academicPrograms.code,
        name: academicPrograms.name,
        degreeLevel: academicPrograms.degreeLevel,
        field: academicPrograms.field,
        orientation: academicPrograms.orientation,
        validFrom: academicPrograms.validFrom,
        validTo: academicPrograms.validTo,
        status: academicPrograms.status,
        version: academicPrograms.version,
      })
      .from(academicPrograms)
      .where(isNull(academicPrograms.deletedAt))
      .orderBy(asc(academicPrograms.degreeLevel), asc(academicPrograms.name));
    const versions = await tx
      .select({
        id: organizationUnitVersions.id,
        organizationUnitId: organizationUnitVersions.organizationUnitId,
        versionNo: organizationUnitVersions.versionNo,
        codeSnapshot: organizationUnitVersions.codeSnapshot,
        nameSnapshot: organizationUnitVersions.nameSnapshot,
        parentNameSnapshot: organizationUnitVersions.parentNameSnapshot,
        validFrom: organizationUnitVersions.validFrom,
        validTo: organizationUnitVersions.validTo,
        reason: organizationUnitVersions.reason,
        createdAt: organizationUnitVersions.createdAt,
      })
      .from(organizationUnitVersions)
      .orderBy(
        asc(organizationUnitVersions.organizationUnitId),
        asc(organizationUnitVersions.versionNo),
      );

    const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
    return {
      years,
      periods,
      units: units.map((unit) => ({
        ...unit,
        parentName: unit.parentId ? (unitName.get(unit.parentId) ?? null) : null,
      })),
      programs: programs.map((program) => ({
        ...program,
        departmentName: unitName.get(program.departmentId) ?? null,
      })),
      versions,
    };
  });
}
