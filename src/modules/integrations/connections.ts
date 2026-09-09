import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { externalIdentityLinks, integrationConnections, user } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { validatePublicHttpsEndpoint } from "@/lib/integrations/webhook-endpoint.ts";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/security/integration-secret.ts";
import type { Viewer } from "@/lib/viewer.ts";

export const ENTERPRISE_CONNECTION_KINDS = [
  "identity_oidc",
  "identity_saml",
  "identity_ldap",
  "scim",
  "sis",
  "hr",
] as const;
export type EnterpriseConnectionKind = (typeof ENTERPRISE_CONNECTION_KINDS)[number];

interface ConnectionConfig {
  endpoint: string;
  identifier?: string;
  secret?: string;
  domain?: string;
  baseDn?: string;
  usernameAttribute?: string;
  metadata?: string;
  requireExistingAccount: true;
  localFallback: true;
}

function isKind(value: string): value is EnterpriseConnectionKind {
  return (ENTERPRISE_CONNECTION_KINDS as readonly string[]).includes(value);
}

function cleanHostUrl(raw: string, kind: EnterpriseConnectionKind): string {
  if (kind === "scim" && raw.trim() === "") {
    const base = process.env.BETTER_AUTH_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!base) return "/api/auth/scim/v2";
    const publicUrl = new URL(base);
    publicUrl.pathname = `${publicUrl.pathname.replace(/\/$/, "")}/api/auth/scim/v2`;
    publicUrl.search = "";
    publicUrl.hash = "";
    return publicUrl.toString();
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("integration endpoint must be an absolute URL");
  }
  if (url.username || url.password || url.hash)
    throw new Error("integration endpoint must not contain credentials or fragments");
  if (kind === "identity_ldap") {
    if (url.protocol !== "ldaps:") throw new Error("LDAP connections must use LDAPS");
  } else if (url.protocol !== "https:") {
    throw new Error("integration endpoint must use HTTPS");
  }
  return url.toString();
}

function normalizeDomain(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase().replace(/^@/, "");
  if (!value) return undefined;
  if (
    value.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) ||
    !value.includes(".")
  ) {
    throw new Error("invalid identity domain");
  }
  return value;
}

function normalizeConfig(
  kind: EnterpriseConnectionKind,
  input: Record<string, string | undefined>,
): ConnectionConfig {
  const endpoint = cleanHostUrl(input.endpoint ?? "", kind);
  const identifier = input.identifier?.trim().slice(0, 500) || undefined;
  const secret = input.secret?.trim().slice(0, 4000) || undefined;
  const domain = normalizeDomain(input.domain);
  const baseDn = input.baseDn?.trim().slice(0, 1000) || undefined;
  const usernameAttribute = input.usernameAttribute?.trim().slice(0, 100) || undefined;
  const metadata = input.metadata?.trim().slice(0, 250_000) || undefined;

  if (kind === "identity_oidc" && (!identifier || !secret || !domain))
    throw new Error("OIDC issuer configuration is incomplete");
  if (kind === "identity_saml" && (!identifier || !domain || !metadata))
    throw new Error("SAML metadata configuration is incomplete");
  if (kind === "identity_ldap" && (!identifier || !secret || !baseDn))
    throw new Error("LDAP directory configuration is incomplete");
  if ((kind === "sis" || kind === "hr") && !secret)
    throw new Error("system API bearer token is required");
  if (kind === "scim" && secret)
    throw new Error("SCIM credentials are generated and rotated separately");

  return {
    endpoint,
    requireExistingAccount: true,
    localFallback: true,
    ...(identifier ? { identifier } : {}),
    ...(secret ? { secret } : {}),
    ...(domain ? { domain } : {}),
    ...(baseDn ? { baseDn } : {}),
    ...(usernameAttribute ? { usernameAttribute } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function ssoProviderId(connectionId: string): string {
  return `univ-sso-${connectionId.replaceAll("-", "")}`;
}

function runtimeSsoRecord(
  connectionId: string,
  ownerUserId: string,
  kind: "identity_oidc" | "identity_saml",
  config: ConnectionConfig,
) {
  const providerId = ssoProviderId(connectionId);
  if (!config.domain || !config.identifier)
    throw new Error("SSO connection is missing required identity fields");
  if (kind === "identity_oidc") {
    if (!config.secret) throw new Error("OIDC client secret is required");
    return {
      id: randomUUID(),
      providerId,
      issuer: config.endpoint.replace(/\/$/, ""),
      domain: config.domain,
      oidcConfig: JSON.stringify({
        clientId: config.identifier,
        clientSecret: config.secret,
        issuer: config.endpoint.replace(/\/$/, ""),
        pkce: true,
        scopes: ["openid", "email", "profile"],
      }),
      samlConfig: null,
      userId: ownerUserId,
      organizationId: null,
    };
  }
  if (!config.metadata) throw new Error("SAML IdP metadata XML is required");
  return {
    id: randomUUID(),
    providerId,
    issuer: config.identifier,
    domain: config.domain,
    oidcConfig: null,
    samlConfig: JSON.stringify({
      entryPoint: config.endpoint,
      wantAssertionsSigned: true,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
      idpInitiatedCallbackUrl: "/",
      idpMetadata: { metadata: config.metadata },
    }),
    userId: ownerUserId,
    organizationId: null,
  };
}

function runtimeFlag(kind: EnterpriseConnectionKind): string {
  return {
    identity_oidc: "ENTERPRISE_OIDC_RUNTIME_ENABLED",
    identity_saml: "ENTERPRISE_SAML_RUNTIME_ENABLED",
    identity_ldap: "ENTERPRISE_LDAP_RUNTIME_ENABLED",
    scim: "ENTERPRISE_SCIM_RUNTIME_ENABLED",
    sis: "ENTERPRISE_SYSTEM_SYNC_RUNTIME_ENABLED",
    hr: "ENTERPRISE_SYSTEM_SYNC_RUNTIME_ENABLED",
  }[kind];
}

export function enterpriseConnectionRuntimeAvailable(kind: EnterpriseConnectionKind): boolean {
  return process.env[runtimeFlag(kind)]?.trim().toLowerCase() === "true";
}

function safeSummary(encrypted: string): { endpoint: string | null; domain: string | null } {
  try {
    const raw = JSON.parse(decryptIntegrationSecret(encrypted)) as Partial<ConnectionConfig>;
    return {
      endpoint: typeof raw.endpoint === "string" ? raw.endpoint : null,
      domain: typeof raw.domain === "string" ? raw.domain : null,
    };
  } catch {
    return { endpoint: null, domain: null };
  }
}

export async function listEnterpriseConnections(tenantId: string) {
  return readOnly(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: integrationConnections.id,
        kind: integrationConnections.kind,
        name: integrationConnections.name,
        configEncrypted: integrationConnections.configEncrypted,
        status: integrationConnections.status,
        lastSyncAt: integrationConnections.lastSyncAt,
        lastError: integrationConnections.lastError,
        version: integrationConnections.version,
        createdAt: integrationConnections.createdAt,
        updatedAt: integrationConnections.updatedAt,
      })
      .from(integrationConnections)
      .where(
        and(
          isNull(integrationConnections.deletedAt),
          sql`${integrationConnections.kind} in ('identity_oidc','identity_saml','identity_ldap','scim','sis','hr')`,
        ),
      )
      .orderBy(asc(integrationConnections.kind), asc(integrationConnections.name));
    return rows.map((row) => {
      const kind = row.kind as EnterpriseConnectionKind;
      return {
        ...row,
        ...safeSummary(row.configEncrypted),
        runtimeAvailable: isKind(kind) && enterpriseConnectionRuntimeAvailable(kind),
        configEncrypted: undefined,
      };
    });
  });
}

export async function createEnterpriseConnection(
  viewer: Viewer,
  input: { kind: string; name: string } & Record<string, string | undefined>,
) {
  if (!isKind(input.kind)) throw new Error("unsupported enterprise connection kind");
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("integration name is required");
  const config = normalizeConfig(input.kind, input);
  const encrypted = encryptIntegrationSecret(JSON.stringify(config));
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .insert(integrationConnections)
      .values({
        tenantId: viewer.tenantId,
        kind: input.kind,
        name,
        configEncrypted: encrypted,
        status: "disabled",
      })
      .returning({ id: integrationConnections.id });
    if (!row) throw new Error("failed to create integration connection");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "integration_connection.create",
      entityType: "integration_connection",
      entityId: row.id,
      changes: JSON.stringify({
        kind: input.kind,
        name,
        endpoint: config.endpoint,
        domain: config.domain ?? null,
        secret: { stored: Boolean(config.secret) },
      }),
    });
    return row;
  });
}

export async function setEnterpriseConnectionStatus(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
  active: boolean,
): Promise<"updated" | "stale" | "runtime-unavailable"> {
  const current = await readOnly(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        kind: integrationConnections.kind,
        configEncrypted: integrationConnections.configEncrypted,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, id),
          eq(integrationConnections.version, expectedVersion),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  });
  if (!current || !isKind(current.kind)) return "stale";
  if (active && !enterpriseConnectionRuntimeAvailable(current.kind)) return "runtime-unavailable";

  const config = JSON.parse(decryptIntegrationSecret(current.configEncrypted)) as ConnectionConfig;
  if (active && (current.kind === "identity_oidc" || current.kind === "identity_saml")) {
    await validatePublicHttpsEndpoint(config.endpoint);
  }

  return withTenant(viewer.tenantId, async (tx) => {
    const status = active ? "active" : "disabled";
    const [row] = await tx
      .update(integrationConnections)
      .set({
        status,
        lastError: null,
        version: sql`${integrationConnections.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.id, id),
          eq(integrationConnections.version, expectedVersion),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .returning({ id: integrationConnections.id });
    if (!row) return "stale" as const;

    if (current.kind === "identity_oidc" || current.kind === "identity_saml") {
      const provider = runtimeSsoRecord(id, viewer.userId, current.kind, config);
      if (active) {
        await tx.execute(sql`select app.materialize_sso_provider(
          ${viewer.tenantId}::uuid, ${id}::uuid, ${provider.providerId}, ${provider.issuer}, ${provider.domain},
          ${provider.oidcConfig}, ${provider.samlConfig}, ${viewer.userId}
        )`);
      } else {
        await tx.execute(
          sql`select app.remove_sso_provider(${viewer.tenantId}::uuid, ${id}::uuid, ${provider.providerId})`,
        );
      }
    }

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: active ? "integration_connection.enable" : "integration_connection.disable",
      entityType: "integration_connection",
      entityId: id,
      changes: JSON.stringify({
        status,
        runtimeMaterialized: current.kind === "identity_oidc" || current.kind === "identity_saml",
      }),
    });
    return "updated" as const;
  });
}

export async function listExternalIdentityLinks(tenantId: string) {
  return readOnly(tenantId, async (tx) =>
    tx
      .select({
        id: externalIdentityLinks.id,
        connectionId: externalIdentityLinks.connectionId,
        providerId: externalIdentityLinks.providerId,
        protocol: externalIdentityLinks.protocol,
        issuer: externalIdentityLinks.issuer,
        subject: externalIdentityLinks.subject,
        userId: externalIdentityLinks.userId,
        username: user.username,
        displayName: user.name,
        status: externalIdentityLinks.status,
        version: externalIdentityLinks.version,
      })
      .from(externalIdentityLinks)
      .innerJoin(
        user,
        and(
          eq(user.id, externalIdentityLinks.userId),
          eq(user.tenantId, externalIdentityLinks.tenantId),
        ),
      )
      .where(isNull(externalIdentityLinks.deletedAt))
      .orderBy(asc(user.username), asc(externalIdentityLinks.providerId)),
  );
}

export async function createExternalIdentityLink(
  viewer: Viewer,
  input: {
    connectionId: string;
    username: string;
    issuer: string;
    subject: string;
  },
) {
  const connectionId = input.connectionId.trim();
  const username = input.username.trim().toLowerCase();
  const issuer = input.issuer.trim();
  const subject = input.subject.trim();
  if (!connectionId || !username || !subject || subject.length > 1000 || issuer.length > 2000)
    throw new Error("identity mapping is incomplete");
  return withTenant(viewer.tenantId, async (tx) => {
    const [connection] = await tx
      .select({ id: integrationConnections.id, kind: integrationConnections.kind })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.id, connectionId),
          isNull(integrationConnections.deletedAt),
          sql`${integrationConnections.kind} in ('identity_oidc','identity_saml','scim')`,
        ),
      )
      .limit(1);
    if (!connection) throw new Error("identity connection was not found");
    if (connection.kind !== "scim" && !issuer) throw new Error("identity issuer is required");
    const [person] = await tx
      .select({ id: user.id })
      .from(user)
      .where(
        and(
          eq(user.tenantId, viewer.tenantId),
          eq(user.displayUsername, username),
          isNull(user.suspendedAt),
        ),
      )
      .limit(1);
    if (!person) throw new Error("local user was not found");
    const providerId =
      connection.kind === "scim"
        ? `univ-scim-${connection.id.replaceAll("-", "")}`
        : ssoProviderId(connection.id);
    const resolvedIssuer = connection.kind === "scim" ? providerId : issuer;
    const [row] = await tx
      .insert(externalIdentityLinks)
      .values({
        tenantId: viewer.tenantId,
        connectionId: connection.id,
        providerId,
        protocol:
          connection.kind === "identity_oidc"
            ? "oidc"
            : connection.kind === "identity_saml"
              ? "saml"
              : "scim",
        issuer: resolvedIssuer,
        subject,
        userId: person.id,
        status: "active",
      })
      .returning({ id: externalIdentityLinks.id });
    if (!row) throw new Error("failed to provision external identity");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "external_identity.provision",
      entityType: "external_identity",
      entityId: row.id,
      changes: JSON.stringify({
        providerId,
        protocol: connection.kind,
        issuer: resolvedIssuer,
        subject,
        userId: person.id,
      }),
    });
    return row;
  });
}

export async function retireExternalIdentityLink(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(externalIdentityLinks)
      .set({
        status: "disabled",
        deletedAt: now,
        updatedAt: now,
        version: sql`${externalIdentityLinks.version}+1`,
      })
      .where(
        and(
          eq(externalIdentityLinks.id, id),
          eq(externalIdentityLinks.version, expectedVersion),
          isNull(externalIdentityLinks.deletedAt),
        ),
      )
      .returning({
        id: externalIdentityLinks.id,
        providerId: externalIdentityLinks.providerId,
        subject: externalIdentityLinks.subject,
      });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "external_identity.retire",
      entityType: "external_identity",
      entityId: id,
      changes: JSON.stringify({ providerId: row.providerId, subject: row.subject }),
    });
    return true;
  });
}

export async function retireEnterpriseConnection(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(integrationConnections)
      .set({
        status: "disabled",
        deletedAt: now,
        version: sql`${integrationConnections.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(integrationConnections.id, id),
          eq(integrationConnections.version, expectedVersion),
          isNull(integrationConnections.deletedAt),
        ),
      )
      .returning({
        id: integrationConnections.id,
        kind: integrationConnections.kind,
        name: integrationConnections.name,
      });
    if (!row) return false;
    if (row.kind === "identity_oidc" || row.kind === "identity_saml") {
      await tx.execute(
        sql`select app.remove_sso_provider(${viewer.tenantId}::uuid, ${id}::uuid, ${ssoProviderId(id)})`,
      );
      await tx
        .update(externalIdentityLinks)
        .set({
          status: "disabled",
          updatedAt: now,
          version: sql`${externalIdentityLinks.version}+1`,
        })
        .where(
          and(eq(externalIdentityLinks.connectionId, id), isNull(externalIdentityLinks.deletedAt)),
        );
    }
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "integration_connection.retire",
      entityType: "integration_connection",
      entityId: id,
      changes: JSON.stringify({ kind: row.kind, name: row.name }),
    });
    return true;
  });
}
