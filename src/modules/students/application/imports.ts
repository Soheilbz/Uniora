import { revalidatePath } from "next/cache";
import { students } from "@/db/schema.ts";
import { importFor, planFor, rollbackFor } from "@/lib/register/import-action.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { STUDENT_FIELDS, STUDENT_LOOKUP_SETS } from "../fields.ts";
import { studentSchema } from "../validation.ts";
import { collectReferenceErrors } from "./reference-validation.ts";

const BASE = "/students";
function studentImportSpec(canChangeDegree: boolean) {
  return {
    table: students,
    id: students.id,
    deletedAt: students.deletedAt,
    version: students.version,
    keyColumn: students.studentNumber,
    keyField: "studentNumber",
    fields: STUDENT_FIELDS,
    lookupSets: STUDENT_LOOKUP_SETS,
    schema: studentSchema,
    namespace: "students",
    entityType: "student",
    validate: collectReferenceErrors,
    restrictedUpdateFields: canChangeDegree ? [] : ["degree"],
  };
}
export async function planStudentImport(text: string) {
  const viewer = await requireCapability("students.manage");
  const { plan } = await planFor(
    viewer.tenantId,
    studentImportSpec(viewer.capabilities.includes("students.degree")),
    text,
  );
  return plan;
}
export async function importStudents(text: string) {
  const viewer = await requireCapability("students.manage");
  const outcome = await importFor(
    viewer.tenantId,
    viewer.userId,
    studentImportSpec(viewer.capabilities.includes("students.degree")),
    text,
  );
  revalidatePath(BASE);
  return outcome;
}
export async function rollbackStudentImport(batchId: string) {
  const viewer = await requireCapability("students.manage");
  const outcome = await rollbackFor(
    viewer.tenantId,
    viewer.userId,
    studentImportSpec(viewer.capabilities.includes("students.degree")),
    batchId,
  );
  if (outcome.rolledBack > 0) revalidatePath(BASE);
  return outcome;
}
