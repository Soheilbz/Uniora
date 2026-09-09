"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createCorrespondenceUseCase,
  transitionCorrespondenceUseCase,
} from "./application/use-cases.ts";

export async function createCorrespondence(form: FormData): Promise<void> {
  const viewer = await requireCapability("correspondence.manage");
  await createCorrespondenceUseCase(viewer, form);
  revalidatePath("/correspondence");
}

export async function transitionCorrespondence(form: FormData): Promise<void> {
  const viewer = await requireCapability("correspondence.manage");
  await transitionCorrespondenceUseCase(viewer, form);
  revalidatePath("/correspondence");
}
