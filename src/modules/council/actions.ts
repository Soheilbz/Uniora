"use server";

import {
  importDecisions as importDecisionsUseCase,
  importMeetings as importMeetingsUseCase,
  planDecisionImport as planDecisionImportUseCase,
  planMeetingImport as planMeetingImportUseCase,
  rollbackDecisionImport as rollbackDecisionImportUseCase,
  rollbackMeetingImport as rollbackMeetingImportUseCase,
} from "./application/imports.ts";
import {
  deleteDecisions as deleteDecisionsUseCase,
  deleteMeetings as deleteMeetingsUseCase,
} from "./application/retire-use-cases.ts";
import {
  saveDecision as saveDecisionUseCase,
  saveMeeting as saveMeetingUseCase,
} from "./application/use-cases.ts";
import { transitionCouncilDecision as transitionCouncilDecisionUseCase } from "./application/workflow.ts";

export async function saveMeeting(...args: Parameters<typeof saveMeetingUseCase>) {
  return saveMeetingUseCase(...args);
}

export async function saveDecision(...args: Parameters<typeof saveDecisionUseCase>) {
  return saveDecisionUseCase(...args);
}

export async function deleteMeetings(...args: Parameters<typeof deleteMeetingsUseCase>) {
  return deleteMeetingsUseCase(...args);
}

export async function deleteDecisions(...args: Parameters<typeof deleteDecisionsUseCase>) {
  return deleteDecisionsUseCase(...args);
}

export async function planMeetingImport(...args: Parameters<typeof planMeetingImportUseCase>) {
  return planMeetingImportUseCase(...args);
}

export async function importMeetings(...args: Parameters<typeof importMeetingsUseCase>) {
  return importMeetingsUseCase(...args);
}

export async function rollbackMeetingImport(
  ...args: Parameters<typeof rollbackMeetingImportUseCase>
) {
  return rollbackMeetingImportUseCase(...args);
}

export async function planDecisionImport(...args: Parameters<typeof planDecisionImportUseCase>) {
  return planDecisionImportUseCase(...args);
}

export async function importDecisions(...args: Parameters<typeof importDecisionsUseCase>) {
  return importDecisionsUseCase(...args);
}

export async function rollbackDecisionImport(
  ...args: Parameters<typeof rollbackDecisionImportUseCase>
) {
  return rollbackDecisionImportUseCase(...args);
}

export async function transitionCouncilDecision(
  ...args: Parameters<typeof transitionCouncilDecisionUseCase>
) {
  return transitionCouncilDecisionUseCase(...args);
}

/**
 * Form actions must resolve to void. Keep the richer use-case result inside
 * the server boundary instead of handing it to React's form action type.
 */
export async function submitCouncilDecisionTransition(form: FormData): Promise<void> {
  await transitionCouncilDecisionUseCase(form);
}
