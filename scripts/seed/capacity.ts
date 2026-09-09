import { eq } from "drizzle-orm";
import type { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";

export async function seedCapacity(db: ReturnType<typeof adminDb>, tenantId: string) {
  const existing = await db
    .select({ id: schema.professorCapacities.id })
    .from(schema.professorCapacities)
    .where(eq(schema.professorCapacities.tenantId, tenantId))
    .limit(1);
  if (existing[0]) {
    console.log("capacity already present");
    return;
  }

  const faculty = await db
    .select({ id: schema.professors.id })
    .from(schema.professors)
    .where(eq(schema.professors.tenantId, tenantId))
    .orderBy(schema.professors.professorCode);

  /* The current Jalali intake year, matching the seeded admission dates. */
  const YEAR = 1404;

  await db.insert(schema.professorCapacities).values(
    faculty.map((professor, index) => ({
      tenantId,
      professorId: professor.id,
      year: YEAR,
      doctorateConcurrentTotal: 4 + index,
      doctorateAnnualTotal: 2,
      mastersConcurrentTotal: 6 + index,
      mastersAnnualTotal: 3,
      doctorateConcurrentCampus: 1,
      mastersConcurrentCampus: 2,
    })),
  );

  console.log(`capacity: ${faculty.length} quotas for ${YEAR}`);
}
