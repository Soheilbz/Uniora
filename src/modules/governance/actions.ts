"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  bootstrapDecisionTemplateDrafts,
  createCapacityRegulationDraft,
  createDecisionTemplateDraft,
  publishCapacityRegulation,
  publishDecisionTemplate,
  retireCapacityRegulation,
} from "./official-rules.ts";

function csv(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createRegulationAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("regulations.manage");
  await createCapacityRegulationDraft(viewer, {
    versionCode: String(form.get("versionCode") ?? ""),
    title: String(form.get("title") ?? ""),
    effectiveFrom: String(form.get("effectiveFrom") ?? ""),
    effectiveTo: String(form.get("effectiveTo") ?? "") || null,
    publicationReference: String(form.get("publicationReference") ?? "") || null,
    approvedBy: String(form.get("approvedBy") ?? "") || null,
    rulesJson: String(form.get("rulesJson") ?? "") || null,
  });
  revalidatePath("/settings/regulations");
  revalidatePath("/professor-capacity");
}

export async function publishRegulationAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("regulations.manage");
  await publishCapacityRegulation(viewer, String(form.get("id") ?? ""));
  revalidatePath("/settings/regulations");
  revalidatePath("/professor-capacity");
}

export async function retireRegulationAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("regulations.manage");
  await retireCapacityRegulation(viewer, String(form.get("id") ?? ""));
  revalidatePath("/settings/regulations");
  revalidatePath("/professor-capacity");
}

export async function createDecisionTemplateAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("templates.manage");
  await createDecisionTemplateDraft(viewer, {
    category: String(form.get("category") ?? ""),
    templateId: String(form.get("templateId") ?? ""),
    title: String(form.get("title") ?? ""),
    bodyTemplate: String(form.get("bodyTemplate") ?? ""),
    placeholders: csv(form.get("placeholders")),
    description: String(form.get("description") ?? "") || null,
  });
  revalidatePath("/settings/decision-templates");
  revalidatePath("/council-decisions");
}

export async function publishDecisionTemplateAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("templates.manage");
  await publishDecisionTemplate(viewer, String(form.get("id") ?? ""));
  revalidatePath("/settings/decision-templates");
  revalidatePath("/council-decisions");
}

export async function bootstrapDecisionTemplatesAction(): Promise<void> {
  const viewer = await requireCapability("templates.manage");
  await bootstrapDecisionTemplateDrafts(viewer);
  revalidatePath("/settings/decision-templates");
}
