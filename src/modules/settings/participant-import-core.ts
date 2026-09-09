import { and, eq, isNull, sql } from "drizzle-orm";
import { lookups, students, workshopParticipants, workshops } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import {
  type ParticipantImportConflictPolicy,
  type ParticipantImportMapping,
  parseParticipantCsv,
  suggestParticipantMapping,
} from "./import-model.ts";

export interface ImportFault {
  row: number;
  reason: string;
  detail: string;
}
export interface ImportReport {
  read: number;
  created: number;
  updated: number;
  skipped: number;
  faults: ImportFault[];
}
export interface PreparedParticipantImport {
  rows: string[][];
  columns: Record<string, number>;
}

export function prepareParticipantCsv(
  text: string,
  mapping: ParticipantImportMapping | undefined,
  maxRows: number,
): PreparedParticipantImport {
  const rows = parseParticipantCsv(text.replace(/^﻿/, ""));
  if (!rows) throw new Error("malformedCsv");
  if (rows.length < 2) throw new Error("noRows");
  if (rows.length - 1 > maxRows) throw new Error("tooManyRows");
  const headers = rows[0] ?? [];
  const selected =
    mapping && Object.keys(mapping).length ? mapping : suggestParticipantMapping(headers);
  const columns = Object.fromEntries(
    Object.entries(selected)
      .map(([field, header]) => [field, headers.indexOf(String(header))])
      .filter(([, index]) => Number(index) >= 0),
  ) as Record<string, number>;
  if (columns.studentNumber === undefined && columns.name === undefined)
    throw new Error("noKeyColumn");
  return { rows: rows.slice(1), columns };
}

export async function applyParticipantImportChunk(input: {
  tenantId: string;
  actorId: string;
  workshopId: string;
  rows: string[][];
  columns: Record<string, number>;
  conflictPolicy: ParticipantImportConflictPolicy;
  rowOffset: number;
  writeAudit?: boolean;
}): Promise<ImportReport> {
  const faults: ImportFault[] = [];
  let created = 0,
    updated = 0,
    skipped = 0;
  await withTenant(input.tenantId, async (tx) => {
    const [workshop] = await tx
      .select({ id: workshops.id, capacity: workshops.capacity })
      .from(workshops)
      .where(and(eq(workshops.id, input.workshopId), isNull(workshops.deletedAt)))
      .limit(1)
      .for("update");
    if (!workshop) {
      faults.push({ row: 0, reason: "unknownWorkshop", detail: input.workshopId });
      return;
    }
    let taken = 0;
    if (workshop.capacity > 0) {
      const [counted] = await tx
        .select({ filled: sql<number>`count(*)`.mapWith(Number) })
        .from(workshopParticipants)
        .where(
          and(
            eq(workshopParticipants.workshopId, input.workshopId),
            isNull(workshopParticipants.deletedAt),
          ),
        );
      taken = counted?.filled ?? 0;
    }
    const statuses = new Set(
      (
        await tx
          .select({ value: lookups.value })
          .from(lookups)
          .where(and(eq(lookups.set, "attendance_statuses"), isNull(lookups.retiredAt)))
      ).map((r) => r.value),
    );
    if (!statuses.has("registered")) {
      faults.push({ row: 0, reason: "unknownAttendance", detail: "registered" });
      return;
    }
    const payments = new Set(
      (
        await tx
          .select({ value: lookups.value })
          .from(lookups)
          .where(and(eq(lookups.set, "payment_statuses"), isNull(lookups.retiredAt)))
      ).map((r) => r.value),
    );
    if (!payments.has("free")) {
      faults.push({ row: 0, reason: "unknownPayment", detail: "free" });
      return;
    }
    for (const [index, row] of input.rows.entries()) {
      const line = input.rowOffset + index + 2;
      const studentNumber =
        input.columns.studentNumber === undefined
          ? ""
          : (row[input.columns.studentNumber] ?? "").trim();
      const name = input.columns.name === undefined ? "" : (row[input.columns.name] ?? "").trim();
      const affiliation =
        input.columns.affiliation === undefined
          ? ""
          : (row[input.columns.affiliation] ?? "").trim();
      const attendance =
        input.columns.attendance === undefined ? "" : (row[input.columns.attendance] ?? "").trim();
      if (
        studentNumber.length > 64 ||
        name.length > 200 ||
        affiliation.length > 200 ||
        attendance.length > 120
      ) {
        faults.push({ row: line, reason: "tooLong", detail: "" });
        continue;
      }
      if (attendance && !statuses.has(attendance)) {
        faults.push({ row: line, reason: "unknownAttendance", detail: attendance });
        continue;
      }
      if (!studentNumber && !name) {
        faults.push({ row: line, reason: "blank", detail: "" });
        continue;
      }
      let studentId: string | null = null;
      if (studentNumber) {
        const [found] = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.studentNumber, studentNumber), isNull(students.deletedAt)))
          .limit(1);
        if (!found) {
          faults.push({ row: line, reason: "unknownStudent", detail: studentNumber });
          continue;
        }
        studentId = found.id;
      }
      const [already] = await tx
        .select({ id: workshopParticipants.id })
        .from(workshopParticipants)
        .where(
          and(
            eq(workshopParticipants.workshopId, input.workshopId),
            isNull(workshopParticipants.deletedAt),
            studentId === null
              ? eq(workshopParticipants.externalName, name)
              : eq(workshopParticipants.studentId, studentId),
          ),
        )
        .limit(1);
      if (already) {
        if (input.conflictPolicy === "update") {
          await tx
            .update(workshopParticipants)
            .set({
              attendanceStatus: attendance || "registered",
              ...(studentId === null ? { externalAffiliation: affiliation || null } : {}),
              updatedAt: new Date(),
              version: sql`${workshopParticipants.version}+1`,
            })
            .where(eq(workshopParticipants.id, already.id));
          updated++;
        } else skipped++;
        continue;
      }
      if (workshop.capacity > 0 && taken >= workshop.capacity) {
        faults.push({ row: line, reason: "capacityFull", detail: String(workshop.capacity) });
        continue;
      }
      await tx.insert(workshopParticipants).values({
        tenantId: input.tenantId,
        workshopId: input.workshopId,
        studentId,
        externalName: studentId === null ? name : null,
        externalAffiliation: studentId === null && affiliation ? affiliation : null,
        attendanceStatus: attendance || "registered",
        paymentStatus: "free",
      });
      taken++;
      created++;
    }
    if (input.writeAudit) {
      await writeAuditEvent(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: "data.import",
        entityType: "workshop",
        entityId: input.workshopId,
        outcome: faults.length === 0 ? "success" : created + updated > 0 ? "partial" : "failure",
        changes: JSON.stringify({
          imported: { to: created },
          updated: { to: updated },
          skipped: { to: skipped },
          rejected: { to: faults.length },
        }),
      });
    }
  });
  return { read: input.rows.length, created, updated, skipped, faults };
}

export async function auditParticipantImportSummary(input: {
  tenantId: string;
  actorId: string;
  workshopId: string;
  report: ImportReport;
  batchId?: string | null;
}) {
  return withTenant(input.tenantId, async (tx) =>
    writeAuditEvent(tx, {
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "data.import",
      entityType: "workshop",
      entityId: input.workshopId,
      outcome:
        input.report.faults.length === 0
          ? "success"
          : input.report.created + input.report.updated > 0
            ? "partial"
            : "failure",
      changes: JSON.stringify({
        batchId: input.batchId ?? null,
        read: input.report.read,
        created: input.report.created,
        updated: input.report.updated,
        skipped: input.report.skipped,
        rejected: input.report.faults.length,
      }),
    }),
  );
}
