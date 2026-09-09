import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { auditLog, user } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { parseAuditChanges } from "@/lib/audit/changes.ts";
import { decodeTimestampCursor, encodeTimestampCursor } from "@/lib/pagination/timestamp-cursor.ts";
import { isValidIsoDate } from "@/lib/register/validation.ts";

export interface AuditEntry {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
}

export interface AuditQuery {
  actor: string;
  entity: string;
  from: string;
  to: string;
  search: string;
  cursor: string;
  direction: "next" | "prev";
}

export const AUDIT_PAGE_SIZE = 50;

/*
 * RLS is still the authorization boundary. Keeping the equivalent tenant
 * predicate in the hot statement lets PostgreSQL plan the tenant access path
 * before evaluating the non-leakproof text filter above the RLS barrier.
 */
const TENANT_SCOPE = sql`${auditLog.tenantId} = app.current_tenant()`;

export interface AuditPage {
  entries: AuditEntry[];
  hasPrevious: boolean;
  hasNext: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
}

export interface AuditFacets {
  actors: { id: string; name: string }[];
  entities: string[];
}

/**
 * Audit register using stable keyset pagination.
 *
 * `OFFSET` gets slower in direct proportion to the age of the page because
 * PostgreSQL must walk and discard every earlier row. The `(created_at,id)`
 * cursor is stable under concurrent inserts and stays O(page-size) even after
 * years of audit history.
 */
export async function readAudit(
  tenantId: string,
  query: AuditQuery,
  limit?: number,
): Promise<AuditPage> {
  const actor = query.actor.slice(0, 255);
  const entity = query.entity.slice(0, 80);
  const search = query.search.trim().slice(0, 120);
  const cursor = limit === undefined ? decodeTimestampCursor(query.cursor) : null;
  const direction = query.direction === "prev" ? "prev" : "next";

  return readOnly(tenantId, async (tx) => {
    let actorMatches: string[] = [];
    if (search) {
      const matched = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`app.fold_text(${user.name}) like '%' || app.fold_text(${search}) || '%'`)
        .limit(500);
      actorMatches = matched.map((row) => row.id);
    }

    const baseConditions = [
      TENANT_SCOPE,
      actor === "" ? undefined : eq(auditLog.actorId, actor),
      entity === "" ? undefined : eq(auditLog.entityType, entity),
      query.from === "" || !isValidIsoDate(query.from)
        ? undefined
        : gte(auditLog.createdAt, sql`${query.from}::date`),
      query.to === "" || !isValidIsoDate(query.to)
        ? undefined
        : lt(auditLog.createdAt, sql`${query.to}::date + interval '1 day'`),
      search === ""
        ? undefined
        : or(
            sql`${auditLog.searchText} like '%' || app.fold_text(${search}) || '%'`,
            actorMatches.length > 0 ? inArray(auditLog.actorId, actorMatches) : undefined,
          ),
    ].filter((one) => one !== undefined);

    const cursorCondition =
      cursor === null
        ? undefined
        : direction === "next"
          ? or(
              lt(auditLog.createdAt, cursor.createdAt),
              and(eq(auditLog.createdAt, cursor.createdAt), lt(auditLog.id, cursor.id)),
            )
          : or(
              gt(auditLog.createdAt, cursor.createdAt),
              and(eq(auditLog.createdAt, cursor.createdAt), gt(auditLog.id, cursor.id)),
            );
    const pageWhere = and(...baseConditions, cursorCondition);
    const baseWhere = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const take = limit ?? AUDIT_PAGE_SIZE + 1;

    let rows = await tx
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        actorId: auditLog.actorId,
        actorName: user.name,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorId))
      .where(limit === undefined ? pageWhere : baseWhere)
      .orderBy(
        direction === "prev" && limit === undefined
          ? asc(auditLog.createdAt)
          : desc(auditLog.createdAt),
        direction === "prev" && limit === undefined ? asc(auditLog.id) : desc(auditLog.id),
      )
      .limit(take);

    const extra = limit === undefined && rows.length > AUDIT_PAGE_SIZE;
    if (extra) rows = rows.slice(0, AUDIT_PAGE_SIZE);
    if (direction === "prev" && limit === undefined) rows = rows.reverse();

    const first = rows[0];
    const last = rows.at(-1);
    const hasPrevious = limit === undefined && (direction === "next" ? cursor !== null : extra);
    const hasNext = limit === undefined && (direction === "prev" ? cursor !== null : extra);

    return {
      entries: rows.map(({ changes, ...row }) => ({ ...row, changes: parseAuditChanges(changes) })),
      hasPrevious,
      hasNext,
      previousCursor: hasPrevious && first ? encodeTimestampCursor(first) : null,
      nextCursor: hasNext && last ? encodeTimestampCursor(last) : null,
    };
  });
}

const cachedAuditFacets = unstable_cache(
  async (tenantId: string): Promise<AuditFacets> =>
    readOnly(tenantId, async (tx) => {
      const [actors, entities] = await Promise.all([
        tx
          .selectDistinct({ id: auditLog.actorId, name: user.name })
          .from(auditLog)
          .leftJoin(user, eq(user.id, auditLog.actorId))
          .where(and(TENANT_SCOPE, sql`${auditLog.actorId} is not null`)),
        tx
          .selectDistinct({ entityType: auditLog.entityType })
          .from(auditLog)
          .where(TENANT_SCOPE)
          .orderBy(auditLog.entityType),
      ]);
      return {
        actors: actors
          .filter((row): row is { id: string; name: string | null } => row.id !== null)
          .map((row) => ({ id: row.id, name: row.name ?? row.id })),
        entities: entities.map((row) => row.entityType),
      };
    }),
  ["audit-facets-v1"],
  { revalidate: 60 },
);

/** Slowly changing filter vocabulary, cached independently from the append-only page read. */
export async function readAuditFacets(tenantId: string): Promise<AuditFacets> {
  return cachedAuditFacets(tenantId);
}
