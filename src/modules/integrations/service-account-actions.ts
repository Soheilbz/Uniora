"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createServiceAccount,
  revokeServiceAccount,
  rotateServiceAccount,
  setServiceAccountStatus,
} from "./service-accounts.ts";

export interface ServiceAccountActionState {
  ok: boolean;
  token?: string;
  prefix?: string;
  error?: "invalid" | "stale" | "failed";
}

function versionOf(form: FormData): number | null {
  const value = Number(form.get("version"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function expiryOf(value: string): Date | null | undefined {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function createServiceAccountAction(
  _previous: ServiceAccountActionState,
  form: FormData,
): Promise<ServiceAccountActionState> {
  const viewer = await requireCapability("api.manage");
  const name = String(form.get("name") ?? "").trim();
  const capabilities = form.getAll("capability").map(String);
  const rateLimitPerMinute = Number(form.get("rateLimitPerMinute") ?? 120);
  const expiresAt = expiryOf(String(form.get("expiresOn") ?? "").trim());
  if (name.length < 2 || capabilities.length === 0 || expiresAt === undefined)
    return { ok: false, error: "invalid" };
  try {
    const created = await createServiceAccount(viewer, {
      name,
      description: String(form.get("description") ?? ""),
      capabilities,
      rateLimitPerMinute,
      expiresAt,
    });
    revalidatePath("/settings/api");
    return { ok: true, token: created.token, prefix: created.tokenPrefix };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function rotateServiceAccountAction(
  _previous: ServiceAccountActionState,
  form: FormData,
): Promise<ServiceAccountActionState> {
  const viewer = await requireCapability("api.manage");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  if (!id || !version) return { ok: false, error: "invalid" };
  const rotated = await rotateServiceAccount(viewer, id, version);
  if (!rotated) return { ok: false, error: "stale" };
  revalidatePath("/settings/api");
  return { ok: true, token: rotated.token, prefix: rotated.tokenPrefix };
}

export async function changeServiceAccountStatusAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("api.manage");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  const status = String(form.get("status") ?? "");
  if (!id || !version || (status !== "active" && status !== "suspended")) return;
  await setServiceAccountStatus(viewer, id, version, status);
  revalidatePath("/settings/api");
}

export async function revokeServiceAccountAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("api.manage");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  if (!id || !version) return;
  await revokeServiceAccount(viewer, id, version);
  revalidatePath("/settings/api");
}
