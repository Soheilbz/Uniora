"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import {
  type ParticipantImportConflictPolicy,
  type ParticipantImportMapping,
  parseParticipantImportMappingJson,
} from "./import-model.ts";
import {
  applyParticipantImportChunk,
  auditParticipantImportSummary,
  type ImportFault,
  type ImportReport,
  prepareParticipantCsv,
} from "./participant-import-core.ts";

export type { ImportFault, ImportReport };

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20_000;
const CHUNK_ROWS = 1000;

export async function importParticipants(
  _previous: (ActionResult & { report?: ImportReport }) | null,
  form: FormData,
): Promise<ActionResult & { report?: ImportReport }> {
  const viewer = await requireCapability("workshops.manage");
  const workshopId = String(form.get("workshopId") ?? "");
  const upload = form.get("file");
  if (!isUuid(workshopId)) return { ok: false, errors: { workshopId: "unknownWorkshop" } };
  if (!(upload instanceof File) || upload.size === 0)
    return { ok: false, errors: { file: "required" } };
  if (upload.size > MAX_BYTES) return { ok: false, errors: { file: "fileTooLarge" } };
  if (!/\.csv$/i.test(upload.name)) return { ok: false, errors: { file: "notCsv" } };
  const text = new TextDecoder("utf-8").decode(await upload.arrayBuffer());
  let mapping: ParticipantImportMapping | undefined;
  try {
    const raw = String(form.get("mapping") ?? "").trim();
    mapping = raw ? parseParticipantImportMappingJson(raw) : undefined;
  } catch {
    return { ok: false, errors: { mapping: "mappingInvalid" } };
  }
  const conflictPolicy = String(form.get("conflictPolicy") ?? "skip");
  const policy: ParticipantImportConflictPolicy = conflictPolicy === "update" ? "update" : "skip";
  let prepared: ReturnType<typeof prepareParticipantCsv>;
  try {
    prepared = prepareParticipantCsv(text, mapping, MAX_ROWS);
  } catch (error) {
    return { ok: false, errors: { file: error instanceof Error ? error.message : "malformedCsv" } };
  }
  const report: ImportReport = {
    read: prepared.rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    faults: [],
  };
  for (let offset = 0; offset < prepared.rows.length; offset += CHUNK_ROWS) {
    const partial = await applyParticipantImportChunk({
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      workshopId,
      rows: prepared.rows.slice(offset, offset + CHUNK_ROWS),
      columns: prepared.columns,
      conflictPolicy: policy,
      rowOffset: offset,
    });
    report.created += partial.created;
    report.updated += partial.updated;
    report.skipped += partial.skipped;
    report.faults.push(...partial.faults);
  }
  await auditParticipantImportSummary({
    tenantId: viewer.tenantId,
    actorId: viewer.userId,
    workshopId,
    report,
  });
  revalidatePath("/workshops");
  revalidatePath(`/workshops/${workshopId}`);
  revalidatePath("/settings/data");
  return {
    ok: report.faults.length === 0,
    message: report.faults.length === 0 ? "importDone" : "importDoneWithFaults",
    report,
  };
}
