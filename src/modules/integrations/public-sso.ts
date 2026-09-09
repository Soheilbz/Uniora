import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";

export interface PublicSsoProvider {
  providerId: string;
  kind: string;
  name: string;
}

/** Public discovery is intentionally backed by a SECURITY DEFINER function. */
export async function readPublicSsoProviders(tenantSlug: string): Promise<PublicSsoProvider[]> {
  const result = await db().execute(sql`
    select provider_id, provider_kind, provider_name
    from app.list_tenant_sso_providers(${tenantSlug})
  `);
  return result.rows.map((row) => ({
    providerId: String(row.provider_id),
    kind: String(row.provider_kind),
    name: String(row.provider_name),
  }));
}
