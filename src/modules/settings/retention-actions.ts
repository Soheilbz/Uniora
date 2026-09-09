"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import { enqueueRetentionRun, saveRetentionPolicy } from "./retention.ts";

const PATH = "/settings/retention";

export async function saveRetentionPolicyAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("retention.manage");
  const retainDays = Number(form.get("retainDays"));
  const expectedVersionRaw = form.get("expectedVersion");
  await saveRetentionPolicy(viewer, {
    resource: String(form.get("resource") ?? ""),
    retainDays,
    enabled: String(form.get("enabled") ?? "") === "true",
    legalHold: String(form.get("legalHold") ?? "") === "true",
    ...(expectedVersionRaw !== null && expectedVersionRaw !== ""
      ? { expectedVersion: Number(expectedVersionRaw) }
      : {}),
  });
  revalidatePath(PATH);
}

export async function runRetentionDryRunAction(): Promise<void> {
  const viewer = await requireCapability("retention.manage");
  await enqueueRetentionRun(viewer, true);
  revalidatePath(PATH);
}

export async function runRetentionPurgeAction(): Promise<void> {
  const viewer = await requireCapability("retention.manage");
  await enqueueRetentionRun(viewer, false);
  revalidatePath(PATH);
}
