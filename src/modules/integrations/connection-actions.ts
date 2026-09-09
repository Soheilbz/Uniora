"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createEnterpriseConnection,
  createExternalIdentityLink,
  retireEnterpriseConnection,
  retireExternalIdentityLink,
  setEnterpriseConnectionStatus,
} from "./connections.ts";

const PATH = "/settings/integrations";

export async function createEnterpriseConnectionAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  await createEnterpriseConnection(viewer, {
    kind: String(form.get("kind") ?? ""),
    name: String(form.get("name") ?? ""),
    endpoint: String(form.get("endpoint") ?? ""),
    identifier: String(form.get("identifier") ?? ""),
    secret: String(form.get("secret") ?? ""),
    domain: String(form.get("domain") ?? ""),
    baseDn: String(form.get("baseDn") ?? ""),
    usernameAttribute: String(form.get("usernameAttribute") ?? ""),
    metadata: String(form.get("metadata") ?? ""),
  });
  revalidatePath(PATH);
}

export async function setEnterpriseConnectionStatusAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1) return;
  await setEnterpriseConnectionStatus(
    viewer,
    String(form.get("id") ?? ""),
    version,
    String(form.get("active") ?? "") === "true",
  );
  revalidatePath(PATH);
}

export async function retireEnterpriseConnectionAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1) return;
  await retireEnterpriseConnection(viewer, String(form.get("id") ?? ""), version);
  revalidatePath(PATH);
}

export async function createExternalIdentityLinkAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  await createExternalIdentityLink(viewer, {
    connectionId: String(form.get("connectionId") ?? ""),
    username: String(form.get("username") ?? ""),
    issuer: String(form.get("issuer") ?? ""),
    subject: String(form.get("subject") ?? ""),
  });
  revalidatePath(PATH);
}

export async function retireExternalIdentityLinkAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("integrations.manage");
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1) return;
  await retireExternalIdentityLink(viewer, String(form.get("id") ?? ""), version);
  revalidatePath(PATH);
}
