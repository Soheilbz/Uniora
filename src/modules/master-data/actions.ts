"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createAcademicPeriodUseCase,
  createAcademicProgramUseCase,
  createAcademicYearUseCase,
  createOrganizationUnitUseCase,
  updateMasterDataStatusUseCase,
  updateOrganizationUnitUseCase,
} from "./application/use-cases.ts";

function refresh(): void {
  revalidatePath("/settings/master-data");
  revalidatePath("/students");
  revalidatePath("/professors");
  revalidatePath("/capacity");
}

export async function createAcademicYear(form: FormData): Promise<void> {
  const viewer = await requireCapability("master-data.manage");
  await createAcademicYearUseCase(viewer, form);
  refresh();
}

export async function createAcademicPeriod(form: FormData): Promise<void> {
  const viewer = await requireCapability("master-data.manage");
  await createAcademicPeriodUseCase(viewer, form);
  refresh();
}

export async function createOrganizationUnit(form: FormData): Promise<void> {
  const viewer = await requireCapability("master-data.manage");
  await createOrganizationUnitUseCase(viewer, form);
  refresh();
}

export async function updateOrganizationUnit(form: FormData): Promise<void> {
  const viewer = await requireCapability("master-data.manage");
  await updateOrganizationUnitUseCase(viewer, form);
  refresh();
}

export async function createAcademicProgram(form: FormData): Promise<void> {
  const viewer = await requireCapability("master-data.manage");
  await createAcademicProgramUseCase(viewer, form);
  refresh();
}

export async function updateMasterDataStatus(form: FormData): Promise<void> {
  const viewer = await requireCapability("master-data.manage");
  await updateMasterDataStatusUseCase(viewer, form);
  refresh();
}
