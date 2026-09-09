"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createResearchProjectUseCase,
  transitionResearchProjectUseCase,
} from "./application/use-cases.ts";

export async function createResearchProject(form: FormData): Promise<void> {
  const viewer = await requireCapability("research-projects.manage");
  await createResearchProjectUseCase(viewer, form);
  revalidatePath("/research-projects");
}

export async function transitionResearchProject(form: FormData): Promise<void> {
  const viewer = await requireCapability("research-projects.manage");
  await transitionResearchProjectUseCase(viewer, form);
  revalidatePath("/research-projects");
}
