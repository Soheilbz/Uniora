import { objectStorage } from "../../src/lib/storage/object-storage.ts";
import {
  parseParticipantCsv,
  suggestParticipantMapping,
} from "../../src/modules/settings/import-model.ts";
import { errorMessage, PermanentJobError } from "../lib/job-errors.mjs";
import { parseStoredArray, parseStoredObject } from "../lib/stored-json.mjs";

/** Large workshop participant-import handler. */
export function createParticipantImportHandler({
  withTenantWrite,
  assertRequesterEligible,
  platformAudit,
  queueStorageReconcileJob,
}) {
  return async function runLargeParticipantImport(job, payload, heartbeat) {
    const batchId = String(payload.batchId ?? "");
    const expectedEtag = String(payload.expectedEtag ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(batchId))
      throw new PermanentJobError("large import requires a valid batchId");
    if (!expectedEtag || expectedEtag.length > 200)
      throw new PermanentJobError("large import requires the prepared object ETag");
    let context;
    try {
      context = await withTenantWrite(job.tenant_id, async (client) => {
        const result = await client.query(
          `select id,workshop_id,requested_by,object_key,size_bytes,mapping_json,conflict_policy,status,processed_rows,total_rows,
                  created_count,updated_count,skipped_count,fault_count,faults_json,expires_at
             from import_batches where id=$1 for update`,
          [batchId],
        );
        const row = result.rows[0];
        if (!row) throw new PermanentJobError("import batch was not found");
        if (row.requested_by !== job.requested_by)
          throw new PermanentJobError("import batch requester does not match job requester");
        if (row.status === "completed") return { ...row, reconciled: true };
        if (["cancelled", "expired"].includes(row.status))
          throw new PermanentJobError(`import batch cannot run from status ${row.status}`);
        if (!["queued", "running", "failed"].includes(row.status))
          throw new PermanentJobError(`import batch cannot run from status ${row.status}`);
        if (new Date(row.expires_at).getTime() <= Date.now())
          throw new PermanentJobError("import batch has expired");
        await assertRequesterEligible(client, job.requested_by, ["workshops.manage"], false);
        await client.query(
          `update import_batches set status='running',public_error=null,completed_at=null,updated_at=now() where id=$1`,
          [batchId],
        );
        return row;
      });

      if (context.reconciled) {
        return {
          batchId,
          processed_rows: context.processed_rows,
          total_rows: context.total_rows,
          created_count: context.created_count,
          updated_count: context.updated_count,
          skipped_count: context.skipped_count,
          fault_count: context.fault_count,
          reconciled: true,
        };
      }

      const storage = objectStorage();
      const headBefore = await storage.head(context.object_key);
      if (
        !headBefore ||
        headBefore.size !== Number(context.size_bytes) ||
        headBefore.etag !== expectedEtag
      )
        throw new PermanentJobError("import object changed after the upload was completed");
      const bytes = await storage.get(context.object_key);
      if (bytes.byteLength !== Number(context.size_bytes))
        throw new PermanentJobError("import object size does not match batch metadata");
      const headAfter = await storage.head(context.object_key);
      if (
        !headAfter ||
        headAfter.size !== Number(context.size_bytes) ||
        headAfter.etag !== expectedEtag
      )
        throw new PermanentJobError("import object changed while it was being read");
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
      const parsed = parseParticipantCsv(text);
      if (!parsed || parsed.length < 2)
        throw new PermanentJobError("import CSV is malformed or empty");
      const body = parsed.slice(1);
      if (body.length > 250_000)
        throw new PermanentJobError("large import exceeds the 250000-row safety limit");
      const headers = parsed[0] ?? [];
      const rawMapping = parseStoredObject(context.mapping_json, "import batch mapping");
      const mapping = Object.keys(rawMapping).length
        ? rawMapping
        : suggestParticipantMapping(headers);
      const columns = {};
      for (const [field, header] of Object.entries(mapping)) {
        const index = headers.indexOf(String(header));
        if (index >= 0 && ["studentNumber", "name", "affiliation", "attendance"].includes(field))
          columns[field] = index;
      }
      if (columns.studentNumber === undefined && columns.name === undefined)
        throw new PermanentJobError("large import has no usable key column mapping");
      const totalRows = body.length;
      let processedRows = Math.min(Number(context.processed_rows ?? 0), totalRows);
      await withTenantWrite(job.tenant_id, async (client) => {
        await client.query(`update import_batches set total_rows=$2,updated_at=now() where id=$1`, [
          batchId,
          totalRows,
        ]);
      });

      while (processedRows < totalRows) {
        const chunk = body.slice(processedRows, processedRows + 1000);
        const outcome = await applyLargeParticipantChunk(job, {
          workshopId: context.workshop_id,
          conflictPolicy: context.conflict_policy === "update" ? "update" : "skip",
          columns,
          rows: chunk,
          rowOffset: processedRows,
        });
        processedRows += chunk.length;
        await heartbeat();
        await withTenantWrite(job.tenant_id, async (client) => {
          const current = await client.query(
            `select faults_json from import_batches where id=$1 for update`,
            [batchId],
          );
          const accumulated = parseStoredArray(current.rows[0]?.faults_json, "import batch faults");
          const room = Math.max(0, 1000 - accumulated.length);
          const boundedFaults = accumulated.concat(outcome.faults.slice(0, room));
          await client.query(
            `update import_batches
                set processed_rows=$2,created_count=created_count+$3,updated_count=updated_count+$4,
                    skipped_count=skipped_count+$5,fault_count=fault_count+$6,faults_json=$7,updated_at=now()
              where id=$1 and status='running'`,
            [
              batchId,
              processedRows,
              outcome.created,
              outcome.updated,
              outcome.skipped,
              outcome.faults.length,
              JSON.stringify(boundedFaults),
            ],
          );
        });
      }

      const final = await withTenantWrite(job.tenant_id, async (client) => {
        const result = await client.query(
          `update import_batches set status='completed',completed_at=now(),public_error=null,updated_at=now()
            where id=$1 and status='running'
            returning processed_rows,total_rows,created_count,updated_count,skipped_count,fault_count`,
          [batchId],
        );
        if (!result.rows[0])
          throw new PermanentJobError("import batch lost its running state before completion");
        return result.rows[0];
      });
      await platformAudit("import.batch.completed", job.tenant_id, batchId, final);
      await queueStorageReconcileJob(job, {
        resourceType: "import-batch",
        resourceId: batchId,
        policy: "cleanup-candidates",
        candidateKeys: [String(context.object_key)],
      });
      return { batchId, ...final };
    } catch (error) {
      const finalAttempt = Number(job.attempt) >= Number(job.max_attempts);
      await withTenantWrite(job.tenant_id, async (client) => {
        await client.query(
          `update import_batches set status=case when $2 then 'failed' else status end,public_error=$3,
                  completed_at=case when $2 then now() else completed_at end,updated_at=now()
            where id=$1 and status in ('queued','running')`,
          [batchId, finalAttempt, errorMessage(error).slice(0, 500)],
        );
      }).catch(() => {});
      if (finalAttempt && context?.object_key) {
        await queueStorageReconcileJob(job, {
          resourceType: "import-batch",
          resourceId: batchId,
          policy: "cleanup-candidates",
          candidateKeys: [String(context.object_key)],
        }).catch(() => undefined);
      }
      throw error;
    }
  };

  async function applyLargeParticipantChunk(job, input) {
    return withTenantWrite(job.tenant_id, async (client) => {
      await assertRequesterEligible(client, job.requested_by, ["workshops.manage"], false);
      const workshop = await client.query(
        `select id,capacity from workshops where id=$1 and deleted_at is null for update`,
        [input.workshopId],
      );
      if (!workshop.rows[0]) throw new PermanentJobError("import workshop no longer exists");
      const capacity = Number(workshop.rows[0].capacity ?? 0);
      const takenResult =
        capacity > 0
          ? await client.query(
              `select count(*)::int c from workshop_participants where workshop_id=$1 and deleted_at is null`,
              [input.workshopId],
            )
          : null;
      let taken = Number(takenResult?.rows[0]?.c ?? 0);
      const attendanceResult = await client.query(
        `select value from lookups where set='attendance_statuses' and retired_at is null`,
      );
      const statuses = new Set(attendanceResult.rows.map((row) => String(row.value)));
      if (!statuses.has("registered"))
        throw new PermanentJobError("required attendance lookup 'registered' is unavailable");
      const paymentResult = await client.query(
        `select value from lookups where set='payment_statuses' and retired_at is null`,
      );
      const payments = new Set(paymentResult.rows.map((row) => String(row.value)));
      if (!payments.has("free"))
        throw new PermanentJobError("required payment lookup 'free' is unavailable");

      const studentNumbers = [
        ...new Set(
          input.rows.map((row) => cellAt(row, input.columns.studentNumber)).filter(Boolean),
        ),
      ];
      const studentMap = new Map();
      if (studentNumbers.length) {
        const found = await client.query(
          `select id,student_number from students where student_number=any($1::text[]) and deleted_at is null`,
          [studentNumbers],
        );
        for (const row of found.rows) studentMap.set(String(row.student_number), String(row.id));
      }
      const existingResult = await client.query(
        `select id,student_id,external_name from workshop_participants where workshop_id=$1 and deleted_at is null`,
        [input.workshopId],
      );
      const byStudent = new Map(
        existingResult.rows
          .filter((row) => row.student_id)
          .map((row) => [String(row.student_id), String(row.id)]),
      );
      const byName = new Map(
        existingResult.rows
          .filter((row) => row.external_name)
          .map((row) => [String(row.external_name).trim(), String(row.id)]),
      );
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const faults = [];
      for (const [index, row] of input.rows.entries()) {
        const line = input.rowOffset + index + 2;
        const studentNumber = cellAt(row, input.columns.studentNumber);
        const name = cellAt(row, input.columns.name);
        const affiliation = cellAt(row, input.columns.affiliation);
        const attendance = cellAt(row, input.columns.attendance);
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
        let studentId = null;
        if (studentNumber) {
          studentId = studentMap.get(studentNumber) ?? null;
          if (!studentId) {
            faults.push({ row: line, reason: "unknownStudent", detail: studentNumber });
            continue;
          }
        }
        const existingId = studentId ? byStudent.get(studentId) : byName.get(name);
        if (existingId) {
          if (input.conflictPolicy === "update") {
            await client.query(
              `update workshop_participants set attendance_status=$2,external_affiliation=case when student_id is null then nullif($3,'') else external_affiliation end,version=version+1,updated_at=now() where id=$1`,
              [existingId, attendance || "registered", affiliation],
            );
            updated += 1;
          } else skipped += 1;
          continue;
        }
        if (capacity > 0 && taken >= capacity) {
          faults.push({ row: line, reason: "capacityFull", detail: String(capacity) });
          continue;
        }
        const inserted = await client.query(
          `insert into workshop_participants(tenant_id,workshop_id,student_id,external_name,external_affiliation,attendance_status,payment_status)
           values(app.current_tenant(),$1,$2,$3,$4,$5,'free') returning id`,
          [
            input.workshopId,
            studentId,
            studentId ? null : name,
            studentId ? null : affiliation || null,
            attendance || "registered",
          ],
        );
        const id = String(inserted.rows[0]?.id ?? "");
        if (studentId) byStudent.set(studentId, id);
        else byName.set(name, id);
        taken += 1;
        created += 1;
      }
      return { created, updated, skipped, faults };
    });
  }
}

function cellAt(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
}
