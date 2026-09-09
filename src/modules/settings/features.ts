"use server";

import { revalidatePath } from "next/cache";
import { FEATURE_CATALOG, isFeatureKey, setTenantFeature } from "@/lib/features.ts";
import { requireCapability } from "@/lib/viewer.ts";

export async function updateTenantFeature(form: FormData): Promise<void> {
  const viewer = await requireCapability("features.manage");
  const feature = String(form.get("feature") ?? "").trim();
  const enabled = String(form.get("enabled") ?? "") === "true";
  if (!isFeatureKey(feature)) return;
  await setTenantFeature(viewer, feature, enabled);
  revalidatePath("/settings/features");
  for (const item of FEATURE_CATALOG) {
    if (item.key === feature) {
      revalidatePath("/");
      break;
    }
  }
}
