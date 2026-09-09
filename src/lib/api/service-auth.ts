import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { withTenant } from "@/db/tenant.ts";
import { type Capability, isCapability } from "@/lib/capabilities.ts";
import { recordApiOutcome } from "@/lib/observability/metrics.ts";
import { isUuid } from "@/lib/uuid.ts";

export interface ApiPrincipal {
  tenantId: string;
  serviceAccountId: string;
  name: string;
  capabilities: readonly Capability[];
}

export async function authenticateServiceRequest(
  request: Request,
  required: readonly Capability[],
): Promise<ApiPrincipal | Response> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1] || match[1].length < 32 || match[1].length > 300) {
    recordApiOutcome("invalid_token");
    return apiError(401, "invalid_token", "A bearer service token is required.");
  }

  const hash = createHash("sha256").update(match[1]).digest("hex");
  const result = await db().execute(sql`select * from app.resolve_service_account(${hash})`);
  const row = result.rows[0] as
    | {
        tenant_id?: unknown;
        service_account_id?: unknown;
        name?: unknown;
        capabilities?: unknown;
        rate_limit_per_minute?: unknown;
      }
    | undefined;

  if (!row?.tenant_id || !row.service_account_id) {
    recordApiOutcome("invalid_token");
    return apiError(401, "invalid_token", "The service token is invalid or expired.");
  }

  const capabilities = parseCapabilities(row.capabilities);
  if (!required.every((capability) => capabilities.includes(capability))) {
    recordApiOutcome("insufficient_scope");
    return apiError(
      403,
      "insufficient_scope",
      "The service account does not have the required capability.",
    );
  }

  const tenantId = String(row.tenant_id);
  const serviceAccountId = String(row.service_account_id);
  if (!isUuid(tenantId) || !isUuid(serviceAccountId)) {
    recordApiOutcome("invalid_token");
    return apiError(401, "invalid_token", "The resolved service principal is invalid.");
  }

  const configuredLimit = Number(row.rate_limit_per_minute ?? 120);
  const limit = Number.isInteger(configuredLimit)
    ? Math.min(Math.max(configuredLimit, 10), 1000)
    : 120;
  if (!(await consumeApiQuota(tenantId, serviceAccountId, limit))) {
    recordApiOutcome("rate_limited");
    return new Response(
      JSON.stringify({
        error: "rate_limited",
        message: "The service-account request limit was exceeded.",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "retry-after": "60",
        },
      },
    );
  }

  recordApiOutcome("accepted");
  return {
    tenantId,
    serviceAccountId,
    name: String(row.name ?? "service-account"),
    capabilities,
  };
}

async function consumeApiQuota(
  tenantId: string,
  serviceAccountId: string,
  limit: number,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.execute(sql`
      insert into api_rate_windows(tenant_id,service_account_id,window_started_at,request_count)
      values(${tenantId},${serviceAccountId},date_trunc('minute',now()),1)
      on conflict (tenant_id,service_account_id,window_started_at)
      do update set request_count=api_rate_windows.request_count+1,updated_at=now()
      returning request_count
    `);
    return (
      Number(
        (result.rows[0] as { request_count?: unknown } | undefined)?.request_count ?? limit + 1,
      ) <= limit
    );
  });
}

function parseCapabilities(raw: unknown): Capability[] {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value.filter(isCapability) : [];
  } catch {
    return [];
  }
}

export function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function apiJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      ...init.headers,
    },
  });
}

export function boundedApiLimit(url: URL): number {
  const value = Number(url.searchParams.get("limit") ?? 50);
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 200) : 50;
}

export function apiCursor(url: URL): string | null | Response {
  const value = url.searchParams.get("cursor")?.trim() ?? "";
  if (!value) return null;
  if (!isUuid(value)) return apiError(400, "invalid_cursor", "The cursor is invalid.");
  return value;
}
