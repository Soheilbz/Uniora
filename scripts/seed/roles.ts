import { eq } from "drizzle-orm";
import type { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";
import { DEFAULT_TENANT_ROLES } from "../../src/lib/tenant-defaults.ts";

export async function seedRoles(
  db: ReturnType<typeof adminDb>,
  tenantId: string,
  adminAuthUsername: string,
) {
  const existing = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.tenantId, tenantId))
    .limit(1);
  if (existing[0]) {
    console.log("roles already present");
    return;
  }

  const definitions = DEFAULT_TENANT_ROLES;

  for (const definition of definitions) {
    const [role] = await db
      .insert(schema.roles)
      .values({
        tenantId,
        key: definition.key,
        name: definition.name,
        tier: definition.tier,
        isSystem: true,
      })
      .returning({ id: schema.roles.id });
    if (!role) continue;

    await db
      .insert(schema.roleCapabilities)
      .values(definition.capabilities.map((capability) => ({ roleId: role.id, capability })));

    if (definition.key === "administrator") {
      const [admin] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.username, adminAuthUsername))
        .limit(1);
      if (admin) {
        await db.insert(schema.userRoles).values({ userId: admin.id, roleId: role.id, tenantId });
      }
    }
  }

  console.log(`roles: ${definitions.map((d) => d.key).join(", ")}`);
}
