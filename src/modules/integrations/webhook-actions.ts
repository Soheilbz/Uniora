"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createWebhookSubscription,
  disableWebhookSubscription,
  rotateWebhookSecret,
  setWebhookStatus,
} from "./webhooks.ts";

export interface WebhookActionState {
  ok: boolean;
  secret?: string;
  error?: "invalid" | "stale" | "failed";
}

const PATH = "/settings/integrations";

function versionOf(form: FormData): number | null {
  const value = Number(form.get("version"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function createWebhookSubscriptionAction(
  _previous: WebhookActionState,
  form: FormData,
): Promise<WebhookActionState> {
  const viewer = await requireCapability("integrations.manage");
  const name = String(form.get("name") ?? "").trim();
  const endpoint = String(form.get("endpoint") ?? "").trim();
  const eventTypes = form.getAll("eventType").map(String);
  if (name.length < 2 || !endpoint || eventTypes.length === 0)
    return { ok: false, error: "invalid" };
  try {
    const created = await createWebhookSubscription(viewer, { name, endpoint, eventTypes });
    revalidatePath(PATH);
    return { ok: true, secret: created.secret };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function rotateWebhookSecretAction(
  _previous: WebhookActionState,
  form: FormData,
): Promise<WebhookActionState> {
  const viewer = await requireCapability("integrations.manage");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  if (!id || !version) return { ok: false, error: "invalid" };
  const result = await rotateWebhookSecret(viewer, id, version);
  if (!result) return { ok: false, error: "stale" };
  revalidatePath(PATH);
  return { ok: true, secret: result.secret };
}

export async function changeWebhookStatusAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  const status = String(form.get("status") ?? "");
  if (!id || !version || (status !== "active" && status !== "paused")) return;
  await setWebhookStatus(viewer, id, version, status);
  revalidatePath(PATH);
}

export async function disableWebhookSubscriptionAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  if (!id || !version) return;
  await disableWebhookSubscription(viewer, id, version);
  revalidatePath(PATH);
}
