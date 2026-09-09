import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { professors, researchProjects } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

/** Structured project register; the PI snapshot remains authoritative for historical display. */
export async function readResearchProjects(tenantId: string, limit = 200) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: researchProjects.id,
        projectCode: researchProjects.projectCode,
        title: researchProjects.title,
        principalInvestigatorId: researchProjects.principalInvestigatorId,
        principalInvestigatorSnapshot: researchProjects.principalInvestigatorSnapshot,
        budget: researchProjects.budget,
        currency: researchProjects.currency,
        fundingSource: researchProjects.fundingSource,
        startsOn: researchProjects.startsOn,
        endsOn: researchProjects.endsOn,
        status: researchProjects.status,
        version: researchProjects.version,
        livePiFirstName: professors.firstName,
        livePiLastName: professors.lastName,
      })
      .from(researchProjects)
      .leftJoin(
        professors,
        and(
          eq(professors.tenantId, researchProjects.tenantId),
          eq(professors.id, researchProjects.principalInvestigatorId),
          isNull(professors.deletedAt),
        ),
      )
      .where(isNull(researchProjects.deletedAt))
      .orderBy(
        asc(researchProjects.status),
        desc(researchProjects.startsOn),
        desc(researchProjects.createdAt),
      )
      .limit(Math.min(Math.max(limit, 1), 300)),
  );
}
