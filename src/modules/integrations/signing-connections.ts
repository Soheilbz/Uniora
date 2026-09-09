import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { integrationConnections } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { validateWebhookEndpointSyntax } from "@/lib/integrations/webhook-endpoint.ts";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/security/integration-secret.ts";
import type { Viewer } from "@/lib/viewer.ts";

interface SigningConfig {
  endpoint: string;
  token: string;
  providerName: string;
  keyId?: string;
  mode: "detached" | "pades";
}

function normalize(input: {
  endpoint: string;
  token: string;
  providerName: string;
  keyId?: string;
  mode?: string;
}): SigningConfig {
  const endpoint = validateWebhookEndpointSyntax(input.endpoint.trim()).toString();
  const token = input.token.trim();
  const providerName = input.providerName.trim().slice(0, 100);
  const keyId = input.keyId?.trim().slice(0, 200) || undefined;
  if (!token || token.length > 8_000) throw new Error("signing token is required");
  if (providerName.length < 2) throw new Error("signing provider name is required");
  return {
    endpoint,
    token,
    providerName,
    mode: input.mode === "pades" ? "pades" : "detached",
    ...(keyId ? { keyId } : {}),
  };
}

function summary(raw: string) {
  try {
    const value = JSON.parse(decryptIntegrationSecret(raw)) as Partial<SigningConfig>;
    return {
      endpoint: typeof value.endpoint === "string" ? value.endpoint : null,
      providerName: typeof value.providerName === "string" ? value.providerName : null,
      mode: value.mode === "pades" ? "pades" : "detached",
      keyId: typeof value.keyId === "string" ? value.keyId : null,
    };
  } catch {
    return { endpoint: null, providerName: null, mode: "detached" as const, keyId: null };
  }
}

export async function listSigningConnections(tenantId: string) {
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({
        id: integrationConnections.id,
        name: integrationConnections.name,
        status: integrationConnections.status,
        version: integrationConnections.version,
        configEncrypted: integrationConnections.configEncrypted,
        lastError: integrationConnections.lastError,
        updatedAt: integrationConnections.updatedAt,
      })
      .from(integrationConnections)
      .where(
        and(eq(integrationConnections.kind, "signing"), isNull(integrationConnections.deletedAt)),
      )
      .orderBy(asc(integrationConnections.name)),
  );
  return rows.map((row) => ({
    ...row,
    ...summary(row.configEncrypted),
    configEncrypted: undefined,
  }));
}

export async function createSigningConnection(
  viewer: Viewer,
  input: {
    name: string;
    endpoint: string;
    token: string;
    providerName: string;
    keyId?: string;
    mode?: string;
  },
) {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("connection name is required");
  const config = normalize(input);
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .insert(integrationConnections)
      .values({
        tenantId: viewer.tenantId,
        kind: "signing",
        name,
        configEncrypted: encryptIntegrationSecret(JSON.stringify(config)),
        status: "disabled",
      })
      .returning({ id: integrationConnections.id });
    if (!row) throw new Error("failed to create signing connection");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "signing_connection.create",
      entityType: "integration_connection",
      entityId: row.id,
      changes: JSON.stringify({
        name,
        providerName: config.providerName,
        endpoint: config.endpoint,
        mode: config.mode,
        keyId: config.keyId ?? null,
        secret: { stored: true },
      }),
    });
    return row;
  });
}

export async function setSigningConnectionStatus(
  viewer: Viewer,
  id: string,
  version: number,
  active: boolean,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    if (active) {
      await tx
        .update(integrationConnections)
        .set({
          status: "disabled",
          version: sql`${integrationConnections.version}+1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationConnections.kind, "signing"),
            eq(integrationConnections.status, "active"),
            isNull(integrationConnections.deletedAt),
          ),
        );
    }
    const [row] = await tx
      .update(integrationConnections)
      .set({
        status: active ? "active" : "disabled",
        lastError: null,
        version: sql`${integrationConnections.version}+1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.id, id),
          eq(integrationConnections.kind, "signing"),
          eq(integrationConnections.version, version),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .returning({ id: integrationConnections.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: active ? "signing_connection.enable" : "signing_connection.disable",
      entityType: "integration_connection",
      entityId: id,
      changes: JSON.stringify({ status: active ? "active" : "disabled" }),
    });
    return true;
  });
}

export async function retireSigningConnection(
  viewer: Viewer,
  id: string,
  version: number,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(integrationConnections)
      .set({
        status: "disabled",
        deletedAt: now,
        version: sql`${integrationConnections.version}+1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationConnections.id, id),
          eq(integrationConnections.kind, "signing"),
          eq(integrationConnections.version, version),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .returning({ id: integrationConnections.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "signing_connection.retire",
      entityType: "integration_connection",
      entityId: id,
    });
    return true;
  });
}
