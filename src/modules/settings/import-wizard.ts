"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { importMappingProfiles, students, workshopParticipants, workshops } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

import {
  type ImportMappingProfileView,
  PARTICIPANT_IMPORT_FIELDS,
  type ParticipantImportConflictPolicy,
  type ParticipantImportField,
  type ParticipantImportMapping,
  type ParticipantImportPreview,
  parseParticipantCsv,
  parseParticipantImportMappingJson,
  suggestParticipantMapping,
} from "./import-model.ts";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 20_000;

function parseMapping(raw: FormDataEntryValue | null, headers: string[]): ParticipantImportMapping {
  if (typeof raw !== "string" || raw.trim() === "") return suggestParticipantMapping(headers);
  const mapping = parseParticipantImportMappingJson(raw);
  if (Object.values(mapping).some((header) => !headers.includes(header))) {
    throw new TypeError("participant import mapping references an unknown CSV header");
  }
  return mapping;
}

function columnIndex(
  headers: string[],
  mapping: ParticipantImportMapping,
  field: ParticipantImportField,
): number | null {
  const header = mapping[field];
  if (!header) return null;
  const index = headers.indexOf(header);
  return index < 0 ? null : index;
}

function cell(row: string[], index: number | null): string {
  return index === null ? "" : (row[index] ?? "").trim();
}

function conflictPolicy(raw: FormDataEntryValue | null): ParticipantImportConflictPolicy {
  return raw === "update" ? "update" : "skip";
}

export async function saveParticipantImportProfile(
  form: FormData,
): Promise<{ ok: boolean; error?: string; profile?: ImportMappingProfileView }> {
  const viewer = await requireCapability("workshops.manage");
  const name = String(form.get("profileName") ?? "").trim();
  if (name.length < 2 || name.length > 100) return { ok: false, error: "profileNameInvalid" };
  let mapping: ParticipantImportMapping;
  try {
    mapping = parseParticipantImportMappingJson(String(form.get("mapping") ?? "{}"));
  } catch {
    return { ok: false, error: "mappingInvalid" };
  }
  const policy = conflictPolicy(form.get("conflictPolicy"));
  return withTenant(viewer.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: importMappingProfiles.id, version: importMappingProfiles.version })
      .from(importMappingProfiles)
      .where(
        and(
          eq(importMappingProfiles.entityType, "workshop_participant"),
          eq(importMappingProfiles.name, name),
          isNull(importMappingProfiles.deletedAt),
        ),
      )
      .limit(1);
    let id: string;
    let version: number;
    if (existing) {
      const [updated] = await tx
        .update(importMappingProfiles)
        .set({
          mappingJson: JSON.stringify(mapping),
          matchStrategyJson: JSON.stringify({ conflictPolicy: policy }),
          updatedAt: new Date(),
          version: sql`${importMappingProfiles.version} + 1`,
        })
        .where(
          and(
            eq(importMappingProfiles.id, existing.id),
            eq(importMappingProfiles.version, existing.version),
          ),
        )
        .returning({ id: importMappingProfiles.id, version: importMappingProfiles.version });
      if (!updated) return { ok: false, error: "conflict" };
      id = updated.id;
      version = updated.version;
    } else {
      const [created] = await tx
        .insert(importMappingProfiles)
        .values({
          tenantId: viewer.tenantId,
          entityType: "workshop_participant",
          name,
          mappingJson: JSON.stringify(mapping),
          matchStrategyJson: JSON.stringify({ conflictPolicy: policy }),
          createdBy: viewer.userId,
        })
        .returning({ id: importMappingProfiles.id, version: importMappingProfiles.version });
      if (!created) return { ok: false, error: "writeFailed" };
      id = created.id;
      version = created.version;
    }
    await writeAuditEvent(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "import.mapping.save",
      entityType: "import_mapping_profile",
      entityId: id,
      outcome: "success",
      changes: JSON.stringify({ name: { to: name }, conflictPolicy: { to: policy } }),
    });
    return {
      ok: true,
      profile: { id, name, mapping, conflictPolicy: policy, version, valid: true },
    };
  });
}

export async function previewParticipantImport(
  form: FormData,
): Promise<{ ok: boolean; error?: string; preview?: ParticipantImportPreview }> {
  const viewer = await requireCapability("workshops.manage");
  const workshopId = String(form.get("workshopId") ?? "");
  const upload = form.get("file");
  if (!isUuid(workshopId)) return { ok: false, error: "unknownWorkshop" };
  if (!(upload instanceof File) || upload.size === 0) return { ok: false, error: "required" };
  if (upload.size > MAX_PREVIEW_BYTES) return { ok: false, error: "fileTooLarge" };
  if (!/\.csv$/i.test(upload.name)) return { ok: false, error: "notCsv" };
  const text = new TextDecoder("utf-8").decode(await upload.arrayBuffer()).replace(/^﻿/, "");
  const rows = parseParticipantCsv(text);
  if (!rows) return { ok: false, error: "malformedCsv" };
  if (rows.length < 2) return { ok: false, error: "noRows" };
  if (rows.length - 1 > MAX_PREVIEW_ROWS) return { ok: false, error: "tooManyRows" };
  const headers = rows[0] ?? [];
  let mapping: ParticipantImportMapping;
  try {
    mapping = parseMapping(form.get("mapping"), headers);
  } catch {
    return { ok: false, error: "mappingInvalid" };
  }
  if (!mapping.studentNumber && !mapping.name) return { ok: false, error: "noKeyColumn" };
  const policy = conflictPolicy(form.get("conflictPolicy"));
  const body = rows.slice(1);
  const indices = Object.fromEntries(
    PARTICIPANT_IMPORT_FIELDS.map((field) => [field, columnIndex(headers, mapping, field)]),
  ) as Record<ParticipantImportField, number | null>;
  const studentNumbers = [
    ...new Set(body.map((row) => cell(row, indices.studentNumber)).filter(Boolean)),
  ].slice(0, MAX_PREVIEW_ROWS);

  return withTenant(viewer.tenantId, async (tx) => {
    const [workshop] = await tx
      .select({ id: workshops.id, capacity: workshops.capacity })
      .from(workshops)
      .where(and(eq(workshops.id, workshopId), isNull(workshops.deletedAt)))
      .limit(1);
    if (!workshop) return { ok: false, error: "unknownWorkshop" };
    const matched =
      studentNumbers.length === 0
        ? []
        : await tx
            .select({ id: students.id, studentNumber: students.studentNumber })
            .from(students)
            .where(
              and(inArray(students.studentNumber, studentNumbers), isNull(students.deletedAt)),
            );
    const studentByNumber = new Map(matched.map((row) => [row.studentNumber, row.id] as const));
    const existing = await tx
      .select({
        studentId: workshopParticipants.studentId,
        externalName: workshopParticipants.externalName,
      })
      .from(workshopParticipants)
      .where(
        and(
          eq(workshopParticipants.workshopId, workshopId),
          isNull(workshopParticipants.deletedAt),
        ),
      );
    const existingStudentIds = new Set(
      existing.map((row) => row.studentId).filter((id): id is string => id !== null),
    );
    const existingNames = new Set(
      existing
        .map((row) => row.externalName?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    const faults: ParticipantImportPreview["faults"] = [];
    let valid = 0,
      matchedStudents = 0,
      unmatchedStudentNumbers = 0,
      existingParticipants = 0,
      wouldCreate = 0,
      wouldUpdate = 0,
      wouldSkip = 0;
    for (const [index, row] of body.entries()) {
      const line = index + 2;
      const studentNumber = cell(row, indices.studentNumber);
      const name = cell(row, indices.name);
      const affiliation = cell(row, indices.affiliation);
      const attendance = cell(row, indices.attendance);
      if (
        studentNumber.length > 64 ||
        name.length > 200 ||
        affiliation.length > 200 ||
        attendance.length > 120
      ) {
        faults.push({ row: line, reason: "tooLong", detail: "" });
        continue;
      }
      if (!studentNumber && !name) {
        faults.push({ row: line, reason: "blank", detail: "" });
        continue;
      }
      let existingParticipant = false;
      if (studentNumber) {
        const studentId = studentByNumber.get(studentNumber);
        if (!studentId) {
          unmatchedStudentNumbers += 1;
          faults.push({ row: line, reason: "unknownStudent", detail: studentNumber });
          continue;
        }
        matchedStudents += 1;
        existingParticipant = existingStudentIds.has(studentId);
      } else existingParticipant = existingNames.has(name);
      valid += 1;
      if (existingParticipant) {
        existingParticipants += 1;
        if (policy === "update") wouldUpdate += 1;
        else wouldSkip += 1;
      } else wouldCreate += 1;
    }
    const capacityRemaining =
      workshop.capacity > 0 ? Math.max(0, workshop.capacity - existing.length) : null;
    const capacityOverflow =
      capacityRemaining === null ? 0 : Math.max(0, wouldCreate - capacityRemaining);
    return {
      ok: true,
      preview: {
        headers,
        mapping,
        sample: body.slice(0, 8),
        read: body.length,
        valid,
        invalid: faults.length,
        matchedStudents,
        unmatchedStudentNumbers,
        existingParticipants,
        wouldCreate,
        wouldUpdate,
        wouldSkip,
        capacityRemaining,
        capacityOverflow,
        faults,
      },
    };
  });
}
