import { and, eq, isNull } from "drizzle-orm";
import {
  correspondence,
  councilDecisions,
  councilMeetings,
  professors,
  researchProjects,
  students,
  workshops,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { DocumentEntityType } from "@/lib/documents/access.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDocumentEntityId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function documentEntityExists(
  tenantId: string,
  entityType: DocumentEntityType,
  entityId: string,
): Promise<boolean> {
  if (!isDocumentEntityId(entityId)) return false;

  return readOnly(tenantId, async (tx) => {
    switch (entityType) {
      case "student": {
        const [row] = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.id, entityId), isNull(students.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
      case "professor": {
        const [row] = await tx
          .select({ id: professors.id })
          .from(professors)
          .where(and(eq(professors.id, entityId), isNull(professors.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
      case "council_decision": {
        const [row] = await tx
          .select({ id: councilDecisions.id })
          .from(councilDecisions)
          .where(and(eq(councilDecisions.id, entityId), isNull(councilDecisions.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
      case "council_meeting": {
        const [row] = await tx
          .select({ id: councilMeetings.id })
          .from(councilMeetings)
          .where(and(eq(councilMeetings.id, entityId), isNull(councilMeetings.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
      case "workshop": {
        const [row] = await tx
          .select({ id: workshops.id })
          .from(workshops)
          .where(and(eq(workshops.id, entityId), isNull(workshops.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
      case "correspondence": {
        const [row] = await tx
          .select({ id: correspondence.id })
          .from(correspondence)
          .where(and(eq(correspondence.id, entityId), isNull(correspondence.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
      case "research_project": {
        const [row] = await tx
          .select({ id: researchProjects.id })
          .from(researchProjects)
          .where(and(eq(researchProjects.id, entityId), isNull(researchProjects.deletedAt)))
          .limit(1);
        return Boolean(row);
      }
    }
  });
}
