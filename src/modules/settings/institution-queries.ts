import { and, eq } from "drizzle-orm";
import { db } from "@/db/client.ts";
import { institutions, tenants } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

export interface Letterhead {
  name: string;
  nameEn: string;
  faculty: string;
  crest: string;
}

export interface InstitutionView {
  name: string;
  nameEn: string;
  faculty: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  timezone: string;
  locale: string;
  calendarSystem: string;
  requireAdminMfa: boolean;
  sessionHours: number;
  passwordMinLength: number;
  crest: string;
  version: number;
}

/** Public branding lookup by immutable tenant slug. No institutional rows are
 * exposed until the caller names a valid, active university. */
export async function readPreAuthLetterhead(tenantSlug?: string): Promise<Letterhead> {
  const slug = tenantSlug?.trim().toLowerCase();
  if (!slug) return { name: "", nameEn: "", faculty: "", crest: "" };
  const [tenant] = await db()
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      and(
        eq(tenants.slug, slug),
        eq(tenants.status, "active"),
        eq(tenants.provisioningStatus, "active"),
      ),
    )
    .limit(1);
  if (!tenant) return { name: "", nameEn: "", faculty: "", crest: "" };

  const [profile] = await readOnly(tenant.id, (tx) =>
    tx
      .select({
        name: institutions.name,
        nameEn: institutions.nameEn,
        faculty: institutions.faculty,
        crest: institutions.crest,
      })
      .from(institutions)
      .where(eq(institutions.tenantId, tenant.id))
      .limit(1),
  );
  return {
    name: profile?.name ?? "",
    nameEn: profile?.nameEn ?? "",
    faculty: profile?.faculty ?? "",
    crest: profile?.crest ?? "",
  };
}

export async function readInstitution(tenantId: string): Promise<InstitutionView> {
  const [row] = await readOnly(tenantId, (tx) =>
    tx
      .select({
        name: institutions.name,
        nameEn: institutions.nameEn,
        faculty: institutions.faculty,
        address: institutions.address,
        phone: institutions.phone,
        email: institutions.email,
        website: institutions.website,
        timezone: institutions.timezone,
        locale: institutions.locale,
        calendarSystem: institutions.calendarSystem,
        requireAdminMfa: institutions.requireAdminMfa,
        sessionHours: institutions.sessionHours,
        passwordMinLength: institutions.passwordMinLength,
        crest: institutions.crest,
        version: institutions.version,
      })
      .from(institutions)
      .where(eq(institutions.tenantId, tenantId))
      .limit(1),
  );
  return (
    row ?? {
      name: "",
      nameEn: "",
      faculty: "",
      address: "",
      phone: "",
      email: "",
      website: "",
      timezone: "Asia/Tehran",
      locale: "fa",
      calendarSystem: "jalali",
      requireAdminMfa: false,
      sessionHours: 8,
      passwordMinLength: 12,
      crest: "",
      version: 0,
    }
  );
}
