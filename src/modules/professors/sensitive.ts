"use server";

import { and, eq, isNull } from "drizzle-orm";
import { piiAccessLog, professors } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import type { Capability } from "@/lib/capabilities.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

export interface SensitiveRevealResult {
  ok: boolean;
  value?: string;
  message?: string;
}

async function revealProfessorField(
  formData: FormData,
  field: "nationalId" | "bankAccountNumber",
  capability: Capability,
): Promise<SensitiveRevealResult> {
  const viewer = await requireCapability(capability);
  const id = String(formData.get("entityId") ?? "").trim();
  if (!isUuid(id)) return { ok: false, message: "errors.record.missing" };

  return withTenant(viewer.tenantId, async (tx) => {
    const selection = field === "nationalId" ? professors.nationalId : professors.bankAccountNumber;
    const [row] = await tx
      .select({ value: selection })
      .from(professors)
      .where(
        and(
          eq(professors.tenantId, viewer.tenantId),
          eq(professors.id, id),
          isNull(professors.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return { ok: false, message: "errors.record.missing" };
    if (!row.value) return { ok: true, value: "" };

    await tx.insert(piiAccessLog).values({
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      entityType: "professor",
      entityId: id,
      field,
      purpose: "record_reveal",
    });
    return { ok: true, value: row.value };
  });
}

export async function revealProfessorNationalId(
  _previous: SensitiveRevealResult | null,
  formData: FormData,
): Promise<SensitiveRevealResult> {
  return revealProfessorField(formData, "nationalId", "professors.sensitive.read");
}

export async function revealProfessorBankAccount(
  _previous: SensitiveRevealResult | null,
  formData: FormData,
): Promise<SensitiveRevealResult> {
  return revealProfessorField(formData, "bankAccountNumber", "professors.bank.read");
}
