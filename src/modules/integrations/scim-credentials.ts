import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { integrationConnections, scimCredentials } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEventCore } from "@/lib/audit-writer-core.ts";
import { SCIM_SCOPES, type ScimScope } from "./scim-types.ts";

type ScimActor = { tenantId: string; userId: string };

const TOKEN_PREFIX = "univ_scim_";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function normalizeScopes(scopes: readonly string[]): ScimScope[] {
  const unique = [
    ...new Set(
      scopes.filter((scope): scope is ScimScope =>
        (SCIM_SCOPES as readonly string[]).includes(scope),
      ),
    ),
  ];
  if (unique.length === 0) throw new Error("at least one SCIM scope is required");
  return unique;
}

function normalizeExpiry(value: Date | null | undefined): Date | null {
  if (!value) return null;
  if (Number.isNaN(value.getTime()) || value <= new Date())
    throw new Error("SCIM credential expiry must be in the future");
  return value;
}

export function scimRuntimeConnectionId(connectionId: string): string {
  return `univ-scim-${connectionId.replaceAll("-", "")}`;
}

export async function listScimCredentials(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: scimCredentials.id,
        connectionId: scimCredentials.connectionId,
        connectionName: integrationConnections.name,
        tokenPrefix: scimCredentials.tokenPrefix,
        scopes: scimCredentials.scopes,
        status: scimCredentials.status,
        expiresAt: scimCredentials.expiresAt,
        lastUsedAt: scimCredentials.lastUsedAt,
        createdAt: scimCredentials.createdAt,
        revokedAt: scimCredentials.revokedAt,
      })
      .from(scimCredentials)
      .innerJoin(
        integrationConnections,
        and(
          eq(integrationConnections.id, scimCredentials.connectionId),
          eq(integrationConnections.tenantId, scimCredentials.tenantId),
        ),
      )
      .where(and(eq(integrationConnections.kind, "scim"), isNull(integrationConnections.deletedAt)))
      .orderBy(asc(integrationConnections.name), asc(scimCredentials.createdAt)),
  ).then((rows) =>
    rows.map((row) => ({
      ...row,
      scopes: (() => {
        try {
          const parsed = JSON.parse(row.scopes) as unknown;
          return Array.isArray(parsed)
            ? parsed.filter((v): v is string => typeof v === "string")
            : [];
        } catch {
          return [];
        }
      })(),
    })),
  );
}

export async function createScimCredential(
  viewer: ScimActor,
  input: {
    connectionId: string;
    scopes: readonly string[];
    expiresAt?: Date | null;
    rotateFromId?: string | null;
  },
): Promise<{ id: string; token: string; tokenPrefix: string }> {
  const scopes = normalizeScopes(input.scopes);
  const expiresAt = normalizeExpiry(input.expiresAt);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, Math.min(token.length, 20));

  return withTenant(viewer.tenantId, async (tx) => {
    const [connection] = await tx
      .select({ id: integrationConnections.id, status: integrationConnections.status })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, input.connectionId),
          eq(integrationConnections.kind, "scim"),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .limit(1);
    if (!connection) throw new Error("SCIM connection was not found");

    let rotateFromId: string | null = null;
    if (input.rotateFromId) {
      const [previous] = await tx
        .select({ id: scimCredentials.id })
        .from(scimCredentials)
        .where(
          and(
            eq(scimCredentials.id, input.rotateFromId),
            eq(scimCredentials.connectionId, connection.id),
            eq(scimCredentials.status, "active"),
          ),
        )
        .limit(1);
      if (!previous) throw new Error("SCIM credential to rotate was not found");
      rotateFromId = previous.id;
    }

    const [created] = await tx
      .insert(scimCredentials)
      .values({
        tenantId: viewer.tenantId,
        connectionId: connection.id,
        tokenHash,
        tokenPrefix,
        scopes: JSON.stringify(scopes),
        status: "active",
        expiresAt,
        createdBy: viewer.userId,
        rotatedFromId: rotateFromId,
      })
      .returning({ id: scimCredentials.id });
    if (!created) throw new Error("failed to create SCIM credential");

    if (rotateFromId) {
      await tx
        .update(scimCredentials)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(scimCredentials.id, rotateFromId));
    }

    await writeAuditEventCore(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: rotateFromId ? "scim.credential.rotate" : "scim.credential.create",
      entityType: "scim_credential",
      entityId: created.id,
      changes: JSON.stringify({
        connectionId: connection.id,
        scopes,
        expiresAt: expiresAt?.toISOString() ?? null,
        rotatedFromId: rotateFromId,
        secret: { returnedOnce: true, persisted: false },
      }),
    });

    return { id: created.id, token, tokenPrefix };
  });
}

export async function revokeScimCredential(viewer: ScimActor, id: string): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(scimCredentials)
      .set({
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      })
      .where(and(eq(scimCredentials.id, id), eq(scimCredentials.status, "active")))
      .returning({ id: scimCredentials.id, connectionId: scimCredentials.connectionId });
    if (!row) return false;
    await writeAuditEventCore(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "scim.credential.revoke",
      entityType: "scim_credential",
      entityId: row.id,
      changes: JSON.stringify({ connectionId: row.connectionId }),
    });
    return true;
  });
}

/**
 * Pre-auth resolver used by Better Auth SCIM. The SQL function is SECURITY
 * DEFINER and returns only an opaque principal after checking tenant lifecycle,
 * connection lifecycle, token expiry and revocation. No tenant table receives
 * an unscoped SELECT grant for this path.
 */
export async function resolveScimBearer(token: string): Promise<null | {
  connection: { id: string; provisioningDomainId: string };
  credentialId: string;
  scopes: ScimScope[];
  expiresAt?: Date;
}> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 512) return null;
  const result = await db().execute(sql`
    select tenant_id, connection_id, credential_id, scopes, expires_at
      from app.resolve_scim_credential(${hashToken(token)})
  `);
  const row = result.rows[0] as
    | {
        tenant_id?: unknown;
        connection_id?: unknown;
        credential_id?: unknown;
        scopes?: unknown;
        expires_at?: unknown;
      }
    | undefined;
  if (!row) return null;
  const tenantId = typeof row.tenant_id === "string" ? row.tenant_id : null;
  const connectionId = typeof row.connection_id === "string" ? row.connection_id : null;
  const credentialId = typeof row.credential_id === "string" ? row.credential_id : null;
  if (!tenantId || !connectionId || !credentialId) return null;
  let scopes: ScimScope[] = [];
  try {
    const parsed = typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes;
    if (Array.isArray(parsed)) scopes = normalizeScopes(parsed.map(String));
  } catch {
    return null;
  }
  const expiresAt = row.expires_at ? new Date(String(row.expires_at)) : undefined;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return null;
  return {
    connection: { id: scimRuntimeConnectionId(connectionId), provisioningDomainId: tenantId },
    credentialId,
    scopes,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export async function resolveScimProvisionedUser(
  connectionId: string,
  externalId: string | undefined,
): Promise<string | null> {
  if (!externalId?.trim()) return null;
  const result = await db().execute(sql`
    select user_id from app.resolve_scim_identity(${connectionId}, ${externalId.trim()})
  `);
  const row = result.rows[0] as { user_id?: unknown } | undefined;
  return typeof row?.user_id === "string" ? row.user_id : null;
}
