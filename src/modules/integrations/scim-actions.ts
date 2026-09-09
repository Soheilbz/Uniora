"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import { createScimCredential, revokeScimCredential } from "./scim-credentials.ts";
import { SCIM_SCOPES } from "./scim-types.ts";

const PATH = "/settings/integrations";

function parseExpiry(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid SCIM credential expiry");
  return parsed;
}

function parseScopes(form: FormData) {
  const raw = form.getAll("scope").map(String);
  return SCIM_SCOPES.filter((scope) => raw.includes(scope));
}

export interface ScimCredentialActionState {
  token?: string;
  tokenPrefix?: string;
  error?: string;
}

export async function createScimCredentialAction(
  _previous: ScimCredentialActionState,
  form: FormData,
): Promise<ScimCredentialActionState> {
  try {
    const viewer = await requireCapability("integrations.manage");
    const result = await createScimCredential(viewer, {
      connectionId: String(form.get("connectionId") ?? ""),
      scopes: parseScopes(form),
      expiresAt: parseExpiry(form.get("expiresAt")),
    });
    revalidatePath(PATH);
    return { token: result.token, tokenPrefix: result.tokenPrefix };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SCIM credential creation failed" };
  }
}

export async function rotateScimCredentialAction(
  _previous: ScimCredentialActionState,
  form: FormData,
): Promise<ScimCredentialActionState> {
  try {
    const viewer = await requireCapability("integrations.manage");
    const result = await createScimCredential(viewer, {
      connectionId: String(form.get("connectionId") ?? ""),
      rotateFromId: String(form.get("id") ?? ""),
      scopes: parseScopes(form),
      expiresAt: parseExpiry(form.get("expiresAt")),
    });
    revalidatePath(PATH);
    return { token: result.token, tokenPrefix: result.tokenPrefix };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SCIM credential rotation failed" };
  }
}

export async function revokeScimCredentialAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  await revokeScimCredential(viewer, String(form.get("id") ?? ""));
  revalidatePath(PATH);
}
