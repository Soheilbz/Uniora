import { asc, isNull } from "drizzle-orm";
import { professors, students } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

/** Shared, read-only identity options used by more than one domain form. */
export interface ProfessorOption {
  id: string;
  name: string;
}

export async function readProfessorOptions(tenantId: string): Promise<ProfessorOption[]> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: professors.id,
        firstName: professors.firstName,
        lastName: professors.lastName,
      })
      .from(professors)
      .where(isNull(professors.deletedAt))
      .orderBy(asc(professors.lastName), asc(professors.firstName)),
  );

  return rows.map((row) => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
  }));
}

export interface StudentOption {
  id: string;
  studentNumber: string;
  name: string;
  degree: string | null;
  fieldOfStudy: string | null;
}

export async function readStudentOptions(tenantId: string): Promise<StudentOption[]> {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: students.id,
        studentNumber: students.studentNumber,
        firstName: students.firstName,
        lastName: students.lastName,
        degree: students.degree,
        fieldOfStudy: students.fieldOfStudy,
      })
      .from(students)
      .where(isNull(students.deletedAt))
      .orderBy(asc(students.lastName), asc(students.firstName)),
  );

  return rows.map((row) => ({
    id: row.id,
    studentNumber: row.studentNumber,
    name: `${row.firstName} ${row.lastName}`.trim(),
    degree: row.degree,
    fieldOfStudy: row.fieldOfStudy,
  }));
}
