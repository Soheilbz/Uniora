import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { serviceAccounts } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { type Capability, isCapability, type Viewer } from "@/lib/capabilities.ts";

export const SERVICE_ACCOUNT_CAPABILITIES = [
  "students.view",
  "students.sensitive.read",
  "students.nationality",
  "professors.view",
  "professors.sensitive.read",
  "professors.bank.read",
  "council.view",
  "workshops.view",
  "research-projects.view",
  "documents.view",
] as const satisfies readonly Capability[];

function issueToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const prefix = randomBytes(5).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `uw_sa_${prefix}_${secret}`;
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tokenPrefix: `uw_sa_${prefix}`,
  };
}

function allowedCapabilities(viewer: Viewer, requested: readonly string[]): Capability[] {
  const exposable = new Set<string>(SERVICE_ACCOUNT_CAPABILITIES);
  const result = requested.filter(
    (value): value is Capability =>
      isCapability(value) && exposable.has(value) && viewer.capabilities.includes(value),
  );
  return [...new Set(result)];
}

export async function createServiceAccount(
  viewer: Viewer,
  input: {
    name: string;
    description?: string;
    capabilities: readonly string[];
    rateLimitPerMinute?: number;
    expiresAt?: Date | null;
  },
) {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("service account name is required");
  const capabilities = allowedCapabilities(viewer, input.capabilities);
  if (capabilities.length === 0) throw new Error("at least one API capability is required");
  const rateLimitPerMinute = Number.isInteger(input.rateLimitPerMinute)
    ? Math.min(Math.max(input.rateLimitPerMinute ?? 120, 10), 1000)
    : 120;
  if (input.expiresAt && input.expiresAt <= new Date())
    throw new Error("service account expiry must be in the future");
  const issued = issueToken();

  const created = await withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .insert(serviceAccounts)
      .values({
        tenantId: viewer.tenantId,
        name,
        description: input.description?.trim().slice(0, 500) || null,
        capabilities: JSON.stringify(capabilities),
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.tokenPrefix,
        rateLimitPerMinute,
        expiresAt: input.expiresAt ?? null,
        createdBy: viewer.userId,
      })
      .returning({
        id: serviceAccounts.id,
        name: serviceAccounts.name,
        tokenPrefix: serviceAccounts.tokenPrefix,
      });
    if (!row) throw new Error("failed to create service account");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "service_account.create",
      entityType: "service_account",
      entityId: row.id,
      changes: JSON.stringify({
        name,
        capabilities,
        rateLimitPerMinute,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      }),
    });
    return row;
  });
  return { ...created, token: issued.token };
}

export async function listServiceAccounts(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: serviceAccounts.id,
        name: serviceAccounts.name,
        description: serviceAccounts.description,
        status: serviceAccounts.status,
        capabilities: serviceAccounts.capabilities,
        tokenPrefix: serviceAccounts.tokenPrefix,
        rateLimitPerMinute: serviceAccounts.rateLimitPerMinute,
        expiresAt: serviceAccounts.expiresAt,
        lastUsedAt: serviceAccounts.lastUsedAt,
        rotatedAt: serviceAccounts.rotatedAt,
        createdAt: serviceAccounts.createdAt,
        version: serviceAccounts.version,
      })
      .from(serviceAccounts)
      .where(isNull(serviceAccounts.deletedAt))
      .orderBy(asc(serviceAccounts.name)),
  );
}

export async function rotateServiceAccount(viewer: Viewer, id: string, expectedVersion: number) {
  const issued = issueToken();
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(serviceAccounts)
      .set({
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.tokenPrefix,
        rotatedAt: new Date(),
        status: "active",
        version: sql`${serviceAccounts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceAccounts.id, id),
          eq(serviceAccounts.version, expectedVersion),
          isNull(serviceAccounts.deletedAt),
        ),
      )
      .returning({ id: serviceAccounts.id, tokenPrefix: serviceAccounts.tokenPrefix });
    if (!row) return null;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "service_account.rotate",
      entityType: "service_account",
      entityId: id,
      changes: JSON.stringify({ tokenPrefix: { to: issued.tokenPrefix } }),
    });
    return { ...row, token: issued.token };
  });
}

export async function setServiceAccountStatus(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
  status: "active" | "suspended",
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(serviceAccounts)
      .set({ status, version: sql`${serviceAccounts.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(serviceAccounts.id, id),
          eq(serviceAccounts.version, expectedVersion),
          isNull(serviceAccounts.deletedAt),
        ),
      )
      .returning({ id: serviceAccounts.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: `service_account.${status}`,
      entityType: "service_account",
      entityId: id,
      changes: JSON.stringify({ status: { to: status } }),
    });
    return true;
  });
}

export async function revokeServiceAccount(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(serviceAccounts)
      .set({
        status: "revoked",
        deletedAt: new Date(),
        version: sql`${serviceAccounts.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceAccounts.id, id),
          eq(serviceAccounts.version, expectedVersion),
          isNull(serviceAccounts.deletedAt),
        ),
      )
      .returning({ id: serviceAccounts.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "service_account.revoke",
      entityType: "service_account",
      entityId: id,
      changes: JSON.stringify({ status: { to: "revoked" } }),
    });
    return true;
  });
}
