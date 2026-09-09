import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { tenantOwners, tenants, user } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { PlatformTenantSummary } from "./platform-types";

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()),
  );
  return results;
}

export async function readPlatformTenantSummaries(): Promise<PlatformTenantSummary[]> {
  const rows = await db()
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      status: tenants.status,
      provisioningStatus: tenants.provisioningStatus,
      provisioningRequestId: tenants.provisioningRequestId,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(asc(tenants.name), asc(tenants.slug));

  return mapWithConcurrency(rows, 4, async (tenant) => {
    const details = await readOnly(
      tenant.id,
      async (tx) => {
        const [manager] = await tx
          .select({
            name: user.name,
            username: user.displayUsername,
            mfaEnabled: user.mfaEnabled,
            mustChangePassword: user.mustChangePassword,
            suspendedAt: user.suspendedAt,
            lastLoginAt: user.lastLoginAt,
          })
          .from(tenantOwners)
          .innerJoin(user, eq(user.id, tenantOwners.userId))
          .where(eq(tenantOwners.tenantId, tenant.id))
          .limit(1);
        const accountRows = await tx
          .select({
            id: user.id,
            name: user.name,
            username: user.displayUsername,
            mustChangePassword: user.mustChangePassword,
            suspendedAt: user.suspendedAt,
            suspendedReason: user.suspendedReason,
            mfaEnabled: user.mfaEnabled,
            lastLoginAt: user.lastLoginAt,
            accountExpiresAt: user.accountExpiresAt,
          })
          .from(user)
          .where(eq(user.tenantId, tenant.id))
          .orderBy(asc(user.name), asc(user.displayUsername));
        let metricRow: Record<string, unknown> | undefined;
        try {
          const metricResult = await tx.execute(sql`
            select
              (select count(*) from "user" where tenant_id = ${tenant.id} and suspended_at is null)::int as active_users,
              (select count(*) from "user" where tenant_id = ${tenant.id} and suspended_at is not null)::int as suspended_users,
              (select count(*) from students where tenant_id = ${tenant.id} and deleted_at is null)::int as students,
              (select count(*) from professors where tenant_id = ${tenant.id} and deleted_at is null)::int as professors,
              (select count(*) from council_meetings where tenant_id = ${tenant.id} and deleted_at is null)::int as meetings,
              (select count(*) from council_decisions where tenant_id = ${tenant.id} and deleted_at is null)::int as decisions,
              (select count(*) from attachments where tenant_id = ${tenant.id} and deleted_at is null)::int as attachments,
              (select coalesce(sum(size_bytes), 0) from attachments where tenant_id = ${tenant.id} and deleted_at is null)::bigint as attachment_bytes
          `);
          metricRow = metricResult.rows[0] as Record<string, unknown> | undefined;
        } catch {
          /* Optional metrics never hide the registry. */
        }
        const visibleAccounts = accountRows.filter((row) => Boolean(row.username));
        return {
          manager: manager?.username
            ? {
                name: manager.name,
                username: manager.username,
                mfaEnabled: manager.mfaEnabled,
                mustChangePassword: manager.mustChangePassword,
                suspendedAt: manager.suspendedAt,
                lastLoginAt: manager.lastLoginAt,
              }
            : null,
          accounts: visibleAccounts.map((row) => ({
            name: row.name,
            username: row.username as string,
            isOwner: row.username === manager?.username,
            mustChangePassword: row.mustChangePassword,
            suspendedAt: row.suspendedAt,
            suspendedReason: row.suspendedReason,
            mfaEnabled: row.mfaEnabled,
            lastLoginAt: row.lastLoginAt,
            accountExpiresAt: row.accountExpiresAt,
          })),
          accountCount: visibleAccounts.length,
          activeAccountCount: visibleAccounts.filter((row) => row.suspendedAt === null).length,
          suspendedAccountCount: visibleAccounts.filter((row) => row.suspendedAt !== null).length,
          metrics: {
            activeUsers: Number(metricRow?.active_users ?? 0),
            suspendedUsers: Number(metricRow?.suspended_users ?? 0),
            students: Number(metricRow?.students ?? 0),
            professors: Number(metricRow?.professors ?? 0),
            meetings: Number(metricRow?.meetings ?? 0),
            decisions: Number(metricRow?.decisions ?? 0),
            attachments: Number(metricRow?.attachments ?? 0),
            attachmentBytes: Number(metricRow?.attachment_bytes ?? 0),
          },
        };
      },
      { allowInactive: true },
    );
    return { ...tenant, ...details };
  });
}

export async function readTenantOwnerEligibility(
  slug: string,
  username: string,
): Promise<"eligible" | "tenant-not-found" | "tenant-not-ready" | "target-not-eligible"> {
  const [tenant] = await db()
    .select({
      id: tenants.id,
      status: tenants.status,
      provisioningStatus: tenants.provisioningStatus,
    })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) return "tenant-not-found";
  if (tenant.status === "archived" || tenant.provisioningStatus !== "active") {
    return "tenant-not-ready";
  }
  const result = await readOnly(
    tenant.id,
    (tx) =>
      tx.execute(sql`
        select exists(
          select 1
            from "user" u
            join user_roles ur on ur.user_id=u.id and ur.tenant_id=u.tenant_id
            join roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
           where u.tenant_id=${tenant.id}
             and lower(u.display_username)=lower(${username})
             and u.suspended_at is null
             and (u.account_expires_at is null or u.account_expires_at > now())
             and not u.must_change_password and r.tier >= 2
             and exists (select 1 from user_roles ur2 join roles r2 on r2.id=ur2.role_id and r2.tenant_id=ur2.tenant_id join role_capabilities rc2 on rc2.role_id=r2.id where ur2.tenant_id=u.tenant_id and ur2.user_id=u.id and rc2.capability='users.manage')
             and exists (select 1 from user_roles ur3 join roles r3 on r3.id=ur3.role_id and r3.tenant_id=ur3.tenant_id join role_capabilities rc3 on rc3.role_id=r3.id where ur3.tenant_id=u.tenant_id and ur3.user_id=u.id and rc3.capability='roles.manage')
        ) as eligible
      `),
    { allowInactive: true },
  );
  const eligible = (result.rows[0] as { eligible?: unknown } | undefined)?.eligible;
  return eligible === true || eligible === "t" ? "eligible" : "target-not-eligible";
}
