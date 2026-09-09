import { and, eq, isNull, sql } from "drizzle-orm";
import { correspondence, correspondenceRecipients } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import type { Viewer } from "@/lib/capabilities.ts";
import { endOfDateInTimeZone } from "@/lib/date-time.ts";
import { allocateDocumentNumber } from "@/lib/documents/numbering.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";

const DIRECTIONS = new Set(["incoming", "outgoing", "internal"]);
const CLASSIFICATIONS = new Set(["public", "internal", "confidential", "restricted"]);
const STATUSES = new Set(["draft", "registered", "referred", "closed", "cancelled"]);
const TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(["registered", "cancelled"]),
  registered: new Set(["referred", "closed", "cancelled"]),
  referred: new Set(["registered", "closed", "cancelled"]),
  closed: new Set(),
  cancelled: new Set(),
};

function field(form: FormData, key: string, max: number): string {
  return String(form.get(key) ?? "")
    .trim()
    .slice(0, max);
}

function dueAtFrom(form: FormData, viewer: Viewer): Date | null {
  const dueOn = field(form, "dueOn", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return null;
  try {
    return endOfDateInTimeZone(dueOn, viewer.tenantTimezone);
  } catch {
    return null;
  }
}

async function institutionalSequenceYear(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
): Promise<number> {
  const result = await tx.execute(sql`
    select case
      when coalesce((select calendar_system from institutions limit 1), 'jalali') = 'gregorian'
        then extract(year from current_date)::int
      else app.jalali_year(current_date)
    end as year
  `);
  const year = Number((result.rows[0] as { year?: number | string } | undefined)?.year);
  if (!Number.isInteger(year)) throw new Error("could not resolve institutional sequence year");
  return year;
}

export async function createCorrespondenceUseCase(viewer: Viewer, form: FormData): Promise<void> {
  const directionRaw = field(form, "direction", 20);
  const direction = DIRECTIONS.has(directionRaw) ? directionRaw : "incoming";
  const subject = field(form, "subject", 500);
  if (!subject) return;
  const classificationRaw = field(form, "classification", 30);
  const classification = CLASSIFICATIONS.has(classificationRaw) ? classificationRaw : "internal";
  const externalNumber = field(form, "number", 120) || null;
  const sender = field(form, "sender", 300) || null;
  const body = field(form, "body", 10_000) || null;
  const recipient = field(form, "recipient", 300);
  const dueAt = dueAtFrom(form, viewer);

  await withTenant(viewer.tenantId, async (tx) => {
    const [created] = await tx
      .insert(correspondence)
      .values({
        tenantId: viewer.tenantId,
        direction,
        number: externalNumber,
        subject,
        body,
        sender,
        dueAt,
        status: "draft",
        classification,
        createdBy: viewer.userId,
      })
      .returning({ id: correspondence.id });
    if (!created) throw new Error("failed to create correspondence");

    if (recipient) {
      await tx.insert(correspondenceRecipients).values({
        tenantId: viewer.tenantId,
        correspondenceId: created.id,
        recipientLabel: recipient,
        recipientType: "text",
        role: "to",
      });
    }

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "correspondence.create",
      entityType: "correspondence",
      entityId: created.id,
      changes: JSON.stringify({ direction, subject, classification, recipient: recipient || null }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "CorrespondenceCreated",
      aggregateType: "correspondence",
      aggregateId: created.id,
      payload: { direction, classification },
    });
  });
}

export async function transitionCorrespondenceUseCase(
  viewer: Viewer,
  form: FormData,
): Promise<void> {
  const id = field(form, "id", 36);
  const version = Number(field(form, "version", 12));
  const next = field(form, "status", 30);
  if (!id || !Number.isSafeInteger(version) || !STATUSES.has(next)) return;

  await withTenant(viewer.tenantId, async (tx) => {
    const [current] = await tx
      .select({
        id: correspondence.id,
        status: correspondence.status,
        direction: correspondence.direction,
        number: correspondence.number,
      })
      .from(correspondence)
      .where(and(eq(correspondence.id, id), isNull(correspondence.deletedAt)))
      .limit(1);
    if (!current || current.status === next) return;
    if (!(TRANSITIONS[current.status] ?? new Set()).has(next)) return;

    let number = current.number;
    if (next === "registered" && !number && current.direction !== "incoming") {
      const year = await institutionalSequenceYear(tx);
      number = await allocateDocumentNumber(tx, {
        tenantId: viewer.tenantId,
        documentType: `correspondence.${current.direction}`,
        year,
        prefix: current.direction === "outgoing" ? "OUT/" : "INT/",
        format: "{prefix}{year}/{number:5}",
      });
    }

    const changed = await tx
      .update(correspondence)
      .set({
        status: next,
        number,
        updatedAt: new Date(),
        version: sql`${correspondence.version} + 1`,
      })
      .where(and(eq(correspondence.id, id), eq(correspondence.version, version)))
      .returning({ id: correspondence.id });
    if (changed.length === 0) return;

    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "correspondence.transition",
      entityType: "correspondence",
      entityId: id,
      changes: JSON.stringify({ status: { from: current.status, to: next }, number }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: "CorrespondenceStatusChanged",
      aggregateType: "correspondence",
      aggregateId: id,
      payload: { from: current.status, to: next, number },
    });
  });
}
