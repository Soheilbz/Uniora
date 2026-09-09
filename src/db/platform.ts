import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

/**
 * Cross-tenant data-administration connection for the long-running Platform
 * worker and its child scripts. The connected role is BYPASSRLS but is not the
 * database owner: it has read access across the database and an explicit DML
 * allow-list, with no schema/role-management authority.
 *
 * Request-serving code must never import this module.
 */
export function platformDb() {
  const url = process.env.DATABASE_PLATFORM_URL;
  if (!url) {
    throw new Error(
      "DATABASE_PLATFORM_URL is not set. Platform worker operations require the dedicated " +
        "univ_platform_worker role; migrations/restores use DATABASE_ADMIN_URL instead.",
    );
  }
  return drizzle(new Pool({ connectionString: url, max: 2 }), { schema });
}
