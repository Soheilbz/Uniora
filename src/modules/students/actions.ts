"use server";

import { bulkEditStudents as bulkEditStudentsUseCase } from "./application/bulk-edit.ts";
import {
  importStudents as importStudentsUseCase,
  planStudentImport as planStudentImportUseCase,
  rollbackStudentImport as rollbackStudentImportUseCase,
} from "./application/imports.ts";
import {
  createStudent as createStudentUseCase,
  deleteStudents as deleteStudentsUseCase,
  deleteStudent as deleteStudentUseCase,
  updateStudent as updateStudentUseCase,
} from "./application/use-cases.ts";

export async function createStudent(...args: Parameters<typeof createStudentUseCase>) {
  return createStudentUseCase(...args);
}

export async function updateStudent(...args: Parameters<typeof updateStudentUseCase>) {
  return updateStudentUseCase(...args);
}

export async function deleteStudents(...args: Parameters<typeof deleteStudentsUseCase>) {
  return deleteStudentsUseCase(...args);
}

export async function deleteStudent(...args: Parameters<typeof deleteStudentUseCase>) {
  return deleteStudentUseCase(...args);
}

export async function bulkEditStudents(...args: Parameters<typeof bulkEditStudentsUseCase>) {
  return bulkEditStudentsUseCase(...args);
}

export async function planStudentImport(...args: Parameters<typeof planStudentImportUseCase>) {
  return planStudentImportUseCase(...args);
}

export async function importStudents(...args: Parameters<typeof importStudentsUseCase>) {
  return importStudentsUseCase(...args);
}

export async function rollbackStudentImport(
  ...args: Parameters<typeof rollbackStudentImportUseCase>
) {
  return rollbackStudentImportUseCase(...args);
}
