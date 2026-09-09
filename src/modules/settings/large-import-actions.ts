"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import type { ParticipantImportConflictPolicy } from "./import-model.ts";
import {
  cancelLargeParticipantImport,
  completeLargeParticipantImport,
  prepareLargeParticipantImport,
} from "./large-import.ts";

export async function prepareLargeParticipantImportAction(input: {
  workshopId: string;
  filename: string;
  sizeBytes: number;
  profileId?: string | null;
  conflictPolicy?: ParticipantImportConflictPolicy;
}) {
  const viewer = await requireCapability("workshops.manage");
  return prepareLargeParticipantImport(viewer, input);
}

export async function completeLargeParticipantImportAction(batchId: string) {
  const viewer = await requireCapability("workshops.manage");
  const result = await completeLargeParticipantImport(viewer, batchId);
  revalidatePath("/settings/import");
  return result;
}

export async function cancelLargeParticipantImportAction(batchId: string) {
  const viewer = await requireCapability("workshops.manage");
  const result = await cancelLargeParticipantImport(viewer, batchId);
  revalidatePath("/settings/import");
  return result;
}
