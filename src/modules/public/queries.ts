import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";

export interface PublicCertificateVerification {
  valid: boolean;
  certificateNumber: string;
  participantName: string;
  workshopTitle: string;
  issueDate: string;
  institutionName: string | null;
}
export async function verifyPublicCertificate(
  code: string,
): Promise<PublicCertificateVerification | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{8,64}$/.test(normalized)) return null;
  const result = await db().execute(sql`select * from app.verify_certificate(${normalized})`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    valid: true,
    certificateNumber: String(row.certificate_number),
    participantName: String(row.participant_name),
    workshopTitle: String(row.workshop_title),
    issueDate: String(row.issue_date),
    institutionName: row.institution_name ? String(row.institution_name) : null,
  };
}

export interface PublicWorkshop {
  publicSlug: string;
  title: string;
  description: string | null;
  workshopDate: string | null;
  durationHours: string | null;
  locationType: string | null;
  venue: string | null;
  capacity: number;
  registrationClosesAt: string | null;
  registrationOpen: boolean;
  registeredCount: number;
  institutionName: string | null;
}
export async function readPublicWorkshop(slug: string): Promise<PublicWorkshop | null> {
  const normalized = slug.trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(normalized)) return null;
  const result = await db().execute(sql`select * from app.public_workshop(${normalized})`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    publicSlug: String(row.public_slug),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    workshopDate: row.workshop_date ? String(row.workshop_date) : null,
    durationHours: row.duration_hours ? String(row.duration_hours) : null,
    locationType: row.location_type ? String(row.location_type) : null,
    venue: row.venue ? String(row.venue) : null,
    capacity: Number(row.capacity ?? 0),
    registrationClosesAt: row.registration_closes_at ? String(row.registration_closes_at) : null,
    registrationOpen: Boolean(row.registration_open),
    registeredCount: Number(row.registered_count ?? 0),
    institutionName: row.institution_name ? String(row.institution_name) : null,
  };
}
