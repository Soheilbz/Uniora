import { and, eq, isNull, sql } from "drizzle-orm";
import { importMappingProfiles, workshops } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { ImportMappingProfileView } from "./import-model.ts";
import { parseParticipantImportProfileJson } from "./import-model.ts";

/** The workshops an import may be loaded into, newest first. */
export async function readImportTargets(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: workshops.id,
        title: workshops.title,
        workshopDate: workshops.workshopDate,
        enrolled: sql<number>`(
          select count(*) from workshop_participants wp
          where wp.workshop_id = workshops.id and wp.deleted_at is null)`.mapWith(Number),
      })
      .from(workshops)
      .where(isNull(workshops.deletedAt))
      .orderBy(sql`${workshops.workshopDate} desc nulls last`)
      .limit(50),
  );
}

export async function readParticipantImportProfiles(
  tenantId: string,
): Promise<ImportMappingProfileView[]> {
  return readOnly(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: importMappingProfiles.id,
        name: importMappingProfiles.name,
        mappingJson: importMappingProfiles.mappingJson,
        matchStrategyJson: importMappingProfiles.matchStrategyJson,
        version: importMappingProfiles.version,
      })
      .from(importMappingProfiles)
      .where(
        and(
          eq(importMappingProfiles.entityType, "workshop_participant"),
          isNull(importMappingProfiles.deletedAt),
        ),
      )
      .orderBy(importMappingProfiles.name)
      .limit(100);
    return rows.map((row) => {
      try {
        const profile = parseParticipantImportProfileJson(row.mappingJson, row.matchStrategyJson);
        return {
          id: row.id,
          name: row.name,
          mapping: profile.mapping,
          conflictPolicy: profile.conflictPolicy,
          version: row.version,
          valid: true,
        };
      } catch {
        // Keep corrupt durable records visible for repair, but never make them executable.
        return {
          id: row.id,
          name: row.name,
          mapping: {},
          conflictPolicy: "skip" as const,
          version: row.version,
          valid: false,
        };
      }
    });
  });
}
