import { asc, eq, sql } from "drizzle-orm";
import { tenantFeatures } from "@/db/schema.ts";
import { readOnly, withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/capabilities.ts";

/**
 * Tenant-selectable product capabilities.
 *
 * Core registers are intentionally absent: a feature flag is not an
 * authorization mechanism and must never be able to turn RLS or a capability
 * check on/off. These flags only decide whether optional product surfaces are
 * offered to an institution after authorization has already succeeded.
 */
export const FEATURE_CATALOG = [
  { key: "workflow", defaultEnabled: false },
  { key: "correspondence", defaultEnabled: false },
  { key: "research-projects", defaultEnabled: false },
  { key: "workshops.public-registration", defaultEnabled: false },
  { key: "portals", defaultEnabled: false },
  { key: "integrations", defaultEnabled: false },
  { key: "advanced-capacity", defaultEnabled: true },
  { key: "public-verification", defaultEnabled: true },
] as const;

export type FeatureKey = (typeof FEATURE_CATALOG)[number]["key"];

const DEFAULTS = new Map<FeatureKey, boolean>(
  FEATURE_CATALOG.map((feature) => [feature.key, feature.defaultEnabled]),
);

export function isFeatureKey(value: string): value is FeatureKey {
  return FEATURE_CATALOG.some((feature) => feature.key === value);
}

export async function readTenantFeatures(tenantId: string): Promise<Map<FeatureKey, boolean>> {
  const result = new Map(DEFAULTS);
  const rows = await readOnly(tenantId, (tx) =>
    tx
      .select({ feature: tenantFeatures.feature, enabled: tenantFeatures.enabled })
      .from(tenantFeatures)
      .orderBy(asc(tenantFeatures.feature)),
  );
  for (const row of rows) {
    if (isFeatureKey(row.feature)) result.set(row.feature, row.enabled);
  }
  return result;
}

export async function enabledTenantFeatures(tenantId: string): Promise<ReadonlySet<FeatureKey>> {
  const values = await readTenantFeatures(tenantId);
  return new Set(
    [...values.entries()].filter(([, enabled]) => enabled).map(([feature]) => feature),
  );
}

export async function isTenantFeatureEnabled(
  tenantId: string,
  feature: FeatureKey,
): Promise<boolean> {
  return (await readTenantFeatures(tenantId)).get(feature) ?? DEFAULTS.get(feature) ?? false;
}

/** Audited, idempotent feature mutation. Authorization belongs to the action/use-case caller. */
export async function setTenantFeature(
  viewer: Viewer,
  feature: FeatureKey,
  enabled: boolean,
): Promise<void> {
  await withTenant(viewer.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: tenantFeatures.id, enabled: tenantFeatures.enabled })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.feature, feature))
      .limit(1);
    const next = enabled;
    if (existing?.enabled === next) return;

    if (existing) {
      await tx
        .update(tenantFeatures)
        .set({ enabled: next, updatedAt: new Date(), version: sql`${tenantFeatures.version} + 1` })
        .where(eq(tenantFeatures.id, existing.id));
    } else {
      await tx.insert(tenantFeatures).values({
        tenantId: viewer.tenantId,
        feature,
        enabled: next,
      });
    }

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: existing ? "feature.update" : "feature.create",
      entityType: "tenant_feature",
      entityId: feature,
      changes: JSON.stringify({ enabled: { from: existing?.enabled ?? null, to: next } }),
    });
  });
}
