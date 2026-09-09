"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import { captureDataQualitySnapshot } from "./data-quality.ts";

export async function runDataQualityScan(): Promise<void> {
  const viewer = await requireCapability("data.quality.manage");
  await captureDataQualitySnapshot(viewer);
  revalidatePath("/settings/data-quality");
}
