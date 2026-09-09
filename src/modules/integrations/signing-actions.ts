"use server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createSigningConnection,
  retireSigningConnection,
  setSigningConnectionStatus,
} from "./signing-connections.ts";

const PATH = "/settings/integrations";
export async function createSigningConnectionAction(form: FormData) {
  const viewer = await requireCapability("integrations.manage");
  await createSigningConnection(viewer, {
    name: String(form.get("name") ?? ""),
    endpoint: String(form.get("endpoint") ?? ""),
    token: String(form.get("token") ?? ""),
    providerName: String(form.get("providerName") ?? ""),
    keyId: String(form.get("keyId") ?? ""),
    mode: String(form.get("mode") ?? ""),
  });
  revalidatePath(PATH);
}
export async function setSigningConnectionStatusAction(form: FormData) {
  const viewer = await requireCapability("integrations.manage");
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1) return;
  await setSigningConnectionStatus(
    viewer,
    String(form.get("id") ?? ""),
    version,
    String(form.get("active") ?? "") === "true",
  );
  revalidatePath(PATH);
}
export async function retireSigningConnectionAction(form: FormData) {
  const viewer = await requireCapability("integrations.manage");
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1) return;
  await retireSigningConnection(viewer, String(form.get("id") ?? ""), version);
  revalidatePath(PATH);
}
