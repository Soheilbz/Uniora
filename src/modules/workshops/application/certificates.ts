import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { workshopCertificates, workshopParticipants, workshops } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { allocateDocumentNumber } from "@/lib/documents/numbering.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

const BASE = "/workshops";

/**
 * Issuing certificates to everybody who attended and has not been given one.
 *
 * ── Why it is a batch, and why it is idempotent ─────────────────────────────
 *
 * The office issues them for a whole workshop at once, after the day. Doing it
 * one at a time would be forty clicks; doing it without the "has not been given
 * one" clause would mint a second certificate for anybody already holding one,
 * every time somebody pressed the button. The unique index on
 * `(tenant, participant)` is the backstop, and this is the behaviour.
 *
 * ── Only those who attended ─────────────────────────────────────────────────
 *
 * Registering is not attending. A workshop that certified everybody who signed
 * up has issued instruments that say something untrue, and the whole value of a
 * certificate is that it does not.
 */
export async function issueCertificates(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("workshops.view", "workshops.manage");

  const workshopId = String(form.get("workshopId") ?? "");
  if (!workshopId || !isUuid(workshopId)) return { ok: false, message: "record.missing" };

  let workshopExists = false;
  let workshopHeld = false;
  await withTenant(viewer.tenantId, async (tx) => {
    /*
     * The workshop row is locked first so its roster cannot move underneath an
     * issuance for that workshop. Certificate numbering itself is institution-
     * wide, so a tenant advisory lock below separately serialises allocation
     * across *different* workshops. Those are two distinct concurrency guards.
     */
    const workshop = await tx
      .select({ id: workshops.id, status: workshops.status })
      .from(workshops)
      .where(and(eq(workshops.id, workshopId), isNull(workshops.deletedAt)))
      .for("update");

    if (workshop.length === 0) return;
    workshopExists = true;
    if (workshop[0]?.status !== "held") return;
    workshopHeld = true;

    const pending = await tx
      .select({ id: workshopParticipants.id })
      .from(workshopParticipants)
      .leftJoin(
        workshopCertificates,
        and(
          eq(workshopCertificates.participantId, workshopParticipants.id),
          isNull(workshopCertificates.deletedAt),
        ),
      )
      .where(
        and(
          eq(workshopParticipants.workshopId, workshopId),
          isNull(workshopParticipants.deletedAt),
          eq(workshopParticipants.attendanceStatus, "attended"),
          isNull(workshopCertificates.id),
        ),
      );

    if (pending.length === 0) return;

    const yearRow = (await tx.execute(sql`select app.jalali_year(current_date) as year`)).rows[0] as
      | { year?: number | string | null }
      | undefined;
    const yearResult = Number(yearRow?.year ?? 0);
    if (!Number.isInteger(yearResult) || yearResult < 1200 || yearResult > 3000) {
      throw new Error("failed to resolve Jalali certificate year");
    }

    const values = [];
    for (const participant of pending) {
      const certificateNumber = await allocateDocumentNumber(tx, {
        tenantId: viewer.tenantId,
        documentType: "workshop-certificate",
        year: yearResult,
        prefix: "W",
        format: "W{year}-{number:3}",
      });
      values.push({
        tenantId: viewer.tenantId,
        workshopId,
        participantId: participant.id,
        certificateNumber,
        issueDate: sql<string>`current_date`,
        verificationCode: randomBytes(9).toString("base64url").toUpperCase(),
      });
    }

    const issued = await tx.insert(workshopCertificates).values(values).returning({
      id: workshopCertificates.id,
      participantId: workshopCertificates.participantId,
    });

    if (issued.length > 0) {
      await writeAuditEvent(
        tx,
        issued.map((certificate) => ({
          tenantId: viewer.tenantId,
          actorId: viewer.userId,
          action: "create",
          entityType: "workshop_certificate",
          entityId: certificate.id,
          changes: JSON.stringify({ participantId: { to: certificate.participantId } }),
        })),
      );
    }
  });

  if (!workshopExists) return { ok: false, message: "record.missing" };
  if (!workshopHeld) return { ok: false, message: "workshops.certificateRequiresHeldWorkshop" };

  revalidatePath(`${BASE}/${workshopId}`);
  return { ok: true };
}
