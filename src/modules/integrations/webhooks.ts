import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { webhookDeliveries, webhookSubscriptions } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { validateWebhookEndpointSyntax } from "@/lib/integrations/webhook-endpoint.ts";
import { encryptIntegrationSecret } from "@/lib/security/integration-secret.ts";
import type { Viewer } from "@/lib/viewer.ts";

export const WEBHOOK_EVENT_TYPES = [
  "StudentCreated",
  "StudentSupervisorChanged",
  "ProfessorUpdated",
  "CouncilDecisionFinalized",
  "WorkshopCertificateIssued",
  "CorrespondenceCreated",
  "CorrespondenceStatusChanged",
  "ResearchProjectCreated",
  "ResearchProjectStatusChanged",
  "OrganizationUnitCreated",
  "OrganizationUnitChanged",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

function normalizeEventTypes(values: readonly string[]): WebhookEventType[] {
  const allowed = new Set<string>(WEBHOOK_EVENT_TYPES);
  return [...new Set(values.filter((value): value is WebhookEventType => allowed.has(value)))];
}

function issueWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

export async function listWebhookSubscriptions(tenantId: string) {
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: webhookSubscriptions.id,
        name: webhookSubscriptions.name,
        endpoint: webhookSubscriptions.endpoint,
        eventTypes: webhookSubscriptions.eventTypes,
        status: webhookSubscriptions.status,
        version: webhookSubscriptions.version,
        createdAt: webhookSubscriptions.createdAt,
        updatedAt: webhookSubscriptions.updatedAt,
      })
      .from(webhookSubscriptions)
      .where(isNull(webhookSubscriptions.deletedAt))
      .orderBy(asc(webhookSubscriptions.name)),
  );
}

export async function listRecentWebhookDeliveries(tenantId: string, limit = 50) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return readOnly(tenantId, (tx) =>
    tx
      .select({
        id: webhookDeliveries.id,
        subscriptionId: webhookDeliveries.subscriptionId,
        subscriptionName: webhookSubscriptions.name,
        status: webhookDeliveries.status,
        attempt: webhookDeliveries.attempt,
        responseStatus: webhookDeliveries.responseStatus,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        deliveredAt: webhookDeliveries.deliveredAt,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookSubscriptions,
        and(
          eq(webhookSubscriptions.tenantId, webhookDeliveries.tenantId),
          eq(webhookSubscriptions.id, webhookDeliveries.subscriptionId),
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(safeLimit),
  );
}

export async function createWebhookSubscription(
  viewer: Viewer,
  input: { name: string; endpoint: string; eventTypes: readonly string[] },
) {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("webhook name is required");
  const endpoint = validateWebhookEndpointSyntax(input.endpoint.trim()).toString();
  const eventTypes = normalizeEventTypes(input.eventTypes);
  if (!eventTypes.length) throw new Error("at least one webhook event is required");
  const secret = issueWebhookSecret();
  const secretEncrypted = encryptIntegrationSecret(secret);

  const row = await withTenant(viewer.tenantId, async (tx) => {
    const [created] = await tx
      .insert(webhookSubscriptions)
      .values({
        tenantId: viewer.tenantId,
        name,
        endpoint,
        eventTypes: JSON.stringify(eventTypes),
        secretEncrypted,
        createdBy: viewer.userId,
      })
      .returning({ id: webhookSubscriptions.id, name: webhookSubscriptions.name });
    if (!created) throw new Error("failed to create webhook subscription");
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "webhook_subscription.create",
      entityType: "webhook_subscription",
      entityId: created.id,
      changes: JSON.stringify({ name, endpoint, eventTypes }),
    });
    return created;
  });
  return { ...row, secret };
}

export async function rotateWebhookSecret(viewer: Viewer, id: string, expectedVersion: number) {
  const secret = issueWebhookSecret();
  const secretEncrypted = encryptIntegrationSecret(secret);
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({
        secretEncrypted,
        version: sql`${webhookSubscriptions.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookSubscriptions.id, id),
          eq(webhookSubscriptions.version, expectedVersion),
          isNull(webhookSubscriptions.deletedAt),
        ),
      )
      .returning({ id: webhookSubscriptions.id });
    if (!row) return null;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "webhook_subscription.rotate_secret",
      entityType: "webhook_subscription",
      entityId: id,
      changes: JSON.stringify({ secret: { rotated: true } }),
    });
    return { id, secret };
  });
}

export async function setWebhookStatus(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
  status: "active" | "paused",
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({ status, version: sql`${webhookSubscriptions.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(webhookSubscriptions.id, id),
          eq(webhookSubscriptions.version, expectedVersion),
          isNull(webhookSubscriptions.deletedAt),
        ),
      )
      .returning({ id: webhookSubscriptions.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: `webhook_subscription.${status}`,
      entityType: "webhook_subscription",
      entityId: id,
      changes: JSON.stringify({ status: { to: status } }),
    });
    return true;
  });
}

export async function disableWebhookSubscription(
  viewer: Viewer,
  id: string,
  expectedVersion: number,
): Promise<boolean> {
  return withTenant(viewer.tenantId, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({
        status: "disabled",
        deletedAt: now,
        version: sql`${webhookSubscriptions.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookSubscriptions.id, id),
          eq(webhookSubscriptions.version, expectedVersion),
          isNull(webhookSubscriptions.deletedAt),
        ),
      )
      .returning({ id: webhookSubscriptions.id });
    if (!row) return false;
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "webhook_subscription.disable",
      entityType: "webhook_subscription",
      entityId: id,
      changes: JSON.stringify({ status: { to: "disabled" } }),
    });
    return true;
  });
}
