"use server";

import {
  bulkEditProfessors as bulkEditProfessorsUseCase,
  createProfessor as createProfessorUseCase,
  deleteProfessors as deleteProfessorsUseCase,
  deleteProfessor as deleteProfessorUseCase,
  importProfessors as importProfessorsUseCase,
  planProfessorImport as planProfessorImportUseCase,
  rollbackProfessorImport as rollbackProfessorImportUseCase,
  updateProfessor as updateProfessorUseCase,
} from "./application/use-cases.ts";

export async function createProfessor(...args: Parameters<typeof createProfessorUseCase>) {
  return createProfessorUseCase(...args);
}

export async function updateProfessor(...args: Parameters<typeof updateProfessorUseCase>) {
  return updateProfessorUseCase(...args);
}

export async function deleteProfessors(...args: Parameters<typeof deleteProfessorsUseCase>) {
  return deleteProfessorsUseCase(...args);
}

export async function bulkEditProfessors(...args: Parameters<typeof bulkEditProfessorsUseCase>) {
  return bulkEditProfessorsUseCase(...args);
}

export async function planProfessorImport(...args: Parameters<typeof planProfessorImportUseCase>) {
  return planProfessorImportUseCase(...args);
}

export async function importProfessors(...args: Parameters<typeof importProfessorsUseCase>) {
  return importProfessorsUseCase(...args);
}

export async function rollbackProfessorImport(
  ...args: Parameters<typeof rollbackProfessorImportUseCase>
) {
  return rollbackProfessorImportUseCase(...args);
}

export async function deleteProfessor(...args: Parameters<typeof deleteProfessorUseCase>) {
  return deleteProfessorUseCase(...args);
}
