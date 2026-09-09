import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { correspondence, correspondenceRecipients } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";

export type CorrespondenceListItem = {
  id: string;
  direction: string;
  number: string | null;
  subject: string;
  sender: string | null;
  dueAt: Date | null;
  status: string;
  classification: string;
  createdAt: Date;
  version: number;
  recipients: string[];
};

/** Tenant-scoped correspondence register with lightweight recipient summaries. */
export async function readCorrespondence(
  tenantId: string,
  limit = 150,
): Promise<CorrespondenceListItem[]> {
  return readOnly(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: correspondence.id,
        direction: correspondence.direction,
        number: correspondence.number,
        subject: correspondence.subject,
        sender: correspondence.sender,
        dueAt: correspondence.dueAt,
        status: correspondence.status,
        classification: correspondence.classification,
        createdAt: correspondence.createdAt,
        version: correspondence.version,
      })
      .from(correspondence)
      .where(isNull(correspondence.deletedAt))
      .orderBy(
        asc(correspondence.status),
        asc(correspondence.dueAt),
        desc(correspondence.createdAt),
        desc(correspondence.id),
      )
      .limit(Math.min(Math.max(limit, 1), 300));

    if (rows.length === 0) return [];

    const recipientRows = await tx
      .select({
        correspondenceId: correspondenceRecipients.correspondenceId,
        label: correspondenceRecipients.recipientLabel,
      })
      .from(correspondenceRecipients)
      .where(
        inArray(
          correspondenceRecipients.correspondenceId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(correspondenceRecipients.createdAt));

    const recipients = new Map<string, string[]>();
    for (const row of recipientRows) {
      const current = recipients.get(row.correspondenceId) ?? [];
      current.push(row.label);
      recipients.set(row.correspondenceId, current);
    }

    return rows.map((row) => ({ ...row, recipients: recipients.get(row.id) ?? [] }));
  });
}

export async function readCorrespondenceById(tenantId: string, id: string) {
  return readOnly(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(correspondence)
      .where(and(eq(correspondence.id, id), isNull(correspondence.deletedAt)))
      .limit(1);
    return row ?? null;
  });
}
