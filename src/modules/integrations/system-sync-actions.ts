"use server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import { requestSystemSync, setStagingRecordDisposition } from "./system-sync.ts";

const PATH = "/settings/integrations";
export async function requestSystemSyncAction(form: FormData) {
  const viewer = await requireCapability("integrations.manage");
  await requestSystemSync(viewer, String(form.get("connectionId") ?? ""));
  revalidatePath(PATH);
}
export async function setStagingDispositionAction(form: FormData) {
  const viewer = await requireCapability("integrations.manage");
  const disposition = String(form.get("disposition") ?? "") === "ignored" ? "ignored" : "pending";
  await setStagingRecordDisposition(viewer, String(form.get("id") ?? ""), disposition);
  revalidatePath(PATH);
}
