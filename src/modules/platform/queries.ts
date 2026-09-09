import { and, asc, count, desc, eq, gt, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import {
  platformAuditExplorer,
  platformOperationRequests,
  tenants,
  user,
  workerRuntimeHealth,
} from "@/db/schema.ts";
import { decodeTimestampCursor, encodeTimestampCursor } from "@/lib/pagination/timestamp-cursor.ts";

export type { PlatformTenantSummary } from "./platform-types";
export { readPlatformTenantSummaries, readTenantOwnerEligibility } from "./tenant-queries";

export interface PlatformOperationSummary {
  id: string;
  kind: string;
  status: string;
  errorCode: string | null;
  failureDetail: string | null;
  requestedBy: string;
  requesterName: string | null;
  requesterUsername: string | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
  targetSlug: string | null;
  targetUsername: string | null;
  targetName: string | null;
}

export interface PlatformOperationMetrics {
  pending: number;
  successful24h: number;
  failed24h: number;
}

export interface PlatformOperationPage {
  items: PlatformOperationSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface PlatformAuditSummary {
  id: string;
  operator: string;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  target: string | null;
  changes: string | null;
  outcome: string;
  requestId: string | null;
  createdAt: Date;
}

export interface PlatformAuditPage {
  items: PlatformAuditSummary[];
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}

export interface PlatformWorkerHealthSummary {
  key: string;
  status: string;
  payload: Record<string, unknown>;
  observedAt: Date;
}

/** Exact queue metrics; never derive operational counters from a truncated history list. */
export async function readPlatformOperationMetrics(): Promise<PlatformOperationMetrics> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db()
    .select({
      pending: sql<number>`count(*) filter (where ${platformOperationRequests.status} in ('queued','running'))::int`,
      successful24h: sql<number>`count(*) filter (where ${platformOperationRequests.status} = 'completed' and ${platformOperationRequests.updatedAt} >= ${since})::int`,
      failed24h: sql<number>`count(*) filter (where ${platformOperationRequests.status} = 'failed' and ${platformOperationRequests.updatedAt} >= ${since})::int`,
    })
    .from(platformOperationRequests);
  return {
    pending: Number(row?.pending ?? 0),
    successful24h: Number(row?.successful24h ?? 0),
    failed24h: Number(row?.failed24h ?? 0),
  };
}

/** Read the sanitized worker registry published by long-running workers. */
export async function readPlatformWorkerHealth(): Promise<PlatformWorkerHealthSummary[]> {
  const rows = await db()
    .select({
      key: workerRuntimeHealth.workerId,
      status: workerRuntimeHealth.status,
      payloadJson: workerRuntimeHealth.payloadJson,
      observedAt: workerRuntimeHealth.observedAt,
    })
    .from(workerRuntimeHealth)
    .orderBy(asc(workerRuntimeHealth.executionClass), asc(workerRuntimeHealth.workerId));
  return rows.map((row) => {
    try {
      const parsed: unknown = JSON.parse(row.payloadJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("worker health payload must be an object");
      return {
        key: row.key,
        status: row.status,
        payload: parsed as Record<string, unknown>,
        observedAt: row.observedAt,
      };
    } catch {
      return {
        key: row.key,
        status: "degraded",
        payload: { diagnostic: "invalid-health-payload" },
        observedAt: row.observedAt,
      };
    }
  });
}

/**
 * A sanitized operations projection for the console.
 *
 * The encrypted payload is intentionally never selected. The only JSON value
 * projected from it is the worker attempt counter, so credentials cannot reach
 * the React tree even accidentally.
 */
export async function readPlatformOperationRequests(
  options: { slug?: string; limit?: number } = {},
): Promise<PlatformOperationSummary[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 24), 1), 100);
  const rows = await db()
    .select({
      id: platformOperationRequests.id,
      kind: platformOperationRequests.kind,
      status: platformOperationRequests.status,
      errorCode: platformOperationRequests.errorMessage,
      failureDetail: sql<
        string | null
      >`nullif(${platformOperationRequests.result}->>'diagnostic', '')`,
      requestedBy: platformOperationRequests.requestedBy,
      requesterName: user.name,
      requesterUsername: user.displayUsername,
      attemptCount: sql<number>`coalesce(nullif(${platformOperationRequests.payload}->'__worker'->>'attempt', '')::integer, 0)`,
      createdAt: platformOperationRequests.createdAt,
      updatedAt: platformOperationRequests.updatedAt,
      processedAt: platformOperationRequests.processedAt,
      targetSlug: sql<string | null>`nullif(${platformOperationRequests.payload}->>'slug', '')`,
      targetUsername: sql<
        string | null
      >`nullif(${platformOperationRequests.payload}->>'username', '')`,
      targetName: sql<
        string | null
      >`nullif(coalesce(${platformOperationRequests.payload}->>'name', ${platformOperationRequests.payload}->>'adminName'), '')`,
    })
    .from(platformOperationRequests)
    .leftJoin(user, eq(user.id, platformOperationRequests.requestedBy))
    .where(options.slug ? eq(platformOperationRequests.targetSlug, options.slug) : undefined)
    .orderBy(desc(platformOperationRequests.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, attemptCount: Number(row.attemptCount ?? 0) }));
}

function platformOperationWhere(options: {
  query?: string | undefined;
  status?: string | undefined;
  kind?: string | undefined;
  operator?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}) {
  const conditions = [];
  if (options.status) conditions.push(eq(platformOperationRequests.status, options.status));
  if (options.kind) conditions.push(eq(platformOperationRequests.kind, options.kind));
  if (options.operator) {
    const pattern = `%${escapeLike(options.operator.trim())}%`;
    conditions.push(or(ilike(user.name, pattern), ilike(user.displayUsername, pattern)));
  }
  if (options.from) conditions.push(gte(platformOperationRequests.createdAt, options.from));
  if (options.to) conditions.push(lt(platformOperationRequests.createdAt, options.to));
  const query = options.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    conditions.push(
      or(
        ilike(platformOperationRequests.kind, pattern),
        ilike(platformOperationRequests.targetSlug, pattern),
        ilike(platformOperationRequests.targetUsername, pattern),
        ilike(platformOperationRequests.targetName, pattern),
        ilike(user.name, pattern),
        ilike(user.displayUsername, pattern),
        ilike(platformOperationRequests.errorMessage, pattern),
      ),
    );
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Server-paginated queue projection for the dedicated operations console. */
export async function readPlatformOperationPage(
  options: {
    query?: string | undefined;
    status?: string | undefined;
    kind?: string | undefined;
    operator?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    limit?: number;
    offset?: number;
  } = {},
): Promise<PlatformOperationPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const where = platformOperationWhere(options);
  const [items, totalRows] = await Promise.all([
    db()
      .select({
        id: platformOperationRequests.id,
        kind: platformOperationRequests.kind,
        status: platformOperationRequests.status,
        errorCode: platformOperationRequests.errorMessage,
        failureDetail: sql<
          string | null
        >`nullif(${platformOperationRequests.result}->>'diagnostic', '')`,
        requestedBy: platformOperationRequests.requestedBy,
        requesterName: user.name,
        requesterUsername: user.displayUsername,
        attemptCount: sql<number>`coalesce(nullif(${platformOperationRequests.payload}->'__worker'->>'attempt', '')::integer, 0)`,
        createdAt: platformOperationRequests.createdAt,
        updatedAt: platformOperationRequests.updatedAt,
        processedAt: platformOperationRequests.processedAt,
        targetSlug: platformOperationRequests.targetSlug,
        targetUsername: platformOperationRequests.targetUsername,
        targetName: platformOperationRequests.targetName,
      })
      .from(platformOperationRequests)
      .leftJoin(user, eq(user.id, platformOperationRequests.requestedBy))
      .where(where)
      .orderBy(desc(platformOperationRequests.createdAt), desc(platformOperationRequests.id))
      .limit(limit)
      .offset(offset),
    db()
      .select({ total: count() })
      .from(platformOperationRequests)
      .leftJoin(user, eq(user.id, platformOperationRequests.requestedBy))
      .where(where),
  ]);
  return {
    items: items.map((row) => ({ ...row, attemptCount: Number(row.attemptCount ?? 0) })),
    total: Number(totalRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Read-only, sanitized platform audit explorer. Changes are retained as text
 * because the audit writer accepts structured JSON and legacy rows may contain
 * plain text; the page never writes or reinterprets them as executable data.
 */
export async function readPlatformAuditEvents(
  options: {
    query?: string | undefined;
    outcome?: string | undefined;
    action?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    limit?: number;
    cursor?: string | undefined;
    direction?: "next" | "prev" | undefined;
  } = {},
): Promise<PlatformAuditPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 100);
  const cursor = decodeTimestampCursor(options.cursor);
  const direction = options.direction === "prev" ? "prev" : "next";
  const conditions = [];
  const query = options.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    const matchingTenants = await db()
      .select({ id: tenants.id })
      .from(tenants)
      .where(or(ilike(tenants.name, pattern), ilike(tenants.slug, pattern)))
      .limit(100);
    const tenantIds = matchingTenants.map((row) => row.id);
    conditions.push(
      or(
        ilike(platformAuditExplorer.operator, pattern),
        ilike(platformAuditExplorer.action, pattern),
        ilike(platformAuditExplorer.target, pattern),
        ilike(platformAuditExplorer.requestId, pattern),
        tenantIds.length > 0 ? inArray(platformAuditExplorer.tenantId, tenantIds) : undefined,
      ),
    );
  }
  if (options.outcome) conditions.push(eq(platformAuditExplorer.outcome, options.outcome));
  if (options.action) conditions.push(eq(platformAuditExplorer.action, options.action));
  if (options.from) conditions.push(gte(platformAuditExplorer.createdAt, options.from));
  if (options.to) conditions.push(lt(platformAuditExplorer.createdAt, options.to));
  if (cursor) {
    conditions.push(
      direction === "next"
        ? or(
            lt(platformAuditExplorer.createdAt, cursor.createdAt),
            and(
              eq(platformAuditExplorer.createdAt, cursor.createdAt),
              lt(platformAuditExplorer.id, cursor.id),
            ),
          )
        : or(
            gt(platformAuditExplorer.createdAt, cursor.createdAt),
            and(
              eq(platformAuditExplorer.createdAt, cursor.createdAt),
              gt(platformAuditExplorer.id, cursor.id),
            ),
          ),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const order = direction === "prev" ? asc : desc;
  let items = await db()
    .select({
      id: platformAuditExplorer.id,
      operator: platformAuditExplorer.operator,
      action: platformAuditExplorer.action,
      tenantId: platformAuditExplorer.tenantId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      target: platformAuditExplorer.target,
      changes: platformAuditExplorer.changes,
      outcome: platformAuditExplorer.outcome,
      requestId: platformAuditExplorer.requestId,
      createdAt: platformAuditExplorer.createdAt,
    })
    .from(platformAuditExplorer)
    .leftJoin(tenants, eq(tenants.id, platformAuditExplorer.tenantId))
    .where(where)
    .orderBy(order(platformAuditExplorer.createdAt), order(platformAuditExplorer.id))
    .limit(limit + 1);

  const hasExtra = items.length > limit;
  if (hasExtra) items = items.slice(0, limit);
  if (direction === "prev") items = items.reverse();
  const first = items[0];
  const last = items.at(-1);
  return {
    items,
    limit,
    hasPrevious: direction === "next" ? cursor !== null : hasExtra,
    hasNext: direction === "prev" ? cursor !== null : hasExtra,
    previousCursor: first ? encodeTimestampCursor(first) : null,
    nextCursor: last ? encodeTimestampCursor(last) : null,
  };
}
