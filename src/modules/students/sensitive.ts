"use server";

import { and, eq, isNull } from "drizzle-orm";
import { piiAccessLog, students } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

export interface SensitiveRevealResult {
  ok: boolean;
  value?: string;
  message?: string;
}

export async function revealStudentNationalId(
  _previous: SensitiveRevealResult | null,
  formData: FormData,
): Promise<SensitiveRevealResult> {
  const viewer = await requireCapability("students.sensitive.read");
  const id = String(formData.get("entityId") ?? "").trim();
  if (!isUuid(id)) return { ok: false, message: "errors.record.missing" };

  return withTenant(viewer.tenantId, async (tx) => {
    const [row] = await tx
      .select({ value: students.nationalId })
      .from(students)
      .where(
        and(
          eq(students.tenantId, viewer.tenantId),
          eq(students.id, id),
          isNull(students.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return { ok: false, message: "errors.record.missing" };
    if (!row.value) return { ok: true, value: "" };

    await tx.insert(piiAccessLog).values({
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      entityType: "student",
      entityId: id,
      field: "nationalId",
      purpose: "record_reveal",
    });
    return { ok: true, value: row.value };
  });
}
