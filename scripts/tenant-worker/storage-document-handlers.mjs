import { createHash } from "node:crypto";
import {
  objectStorage,
  safeObjectKeyPart,
  tenantPromotedObjectKey,
} from "../../src/lib/storage/object-storage.ts";
import { malwareScanner } from "../../src/lib/storage/scanner.ts";
import { PermanentJobError, RetryableJobError } from "../lib/job-errors.mjs";
import { parseStoredArray } from "../lib/stored-json.mjs";

/** Durable object lifecycle + document scan handlers. */
export function createStorageDocumentHandlers({
  withTenantWrite,
  withTenantMaintenance,
  withTenantSnapshot,
  assertRequesterEligible,
}) {
  // Validate the binary-storage and malware-scanner providers before the worker
  // claims any durable job. The providers are lazy/no-network constructors; this
  // preserves fail-fast startup without creating an external side effect.
  objectStorage();
  malwareScanner();

  async function queueStorageReconcileJob(
    job,
    payload,
    scheduledAt = new Date(),
    maxAttempts = 12,
  ) {
    const canonical = JSON.stringify(payload);
    const dedupeKey = createHash("sha256").update(`storage.reconcile\0${canonical}`).digest("hex");
    return withTenantWrite(job.tenant_id, async (client) => {
      const existing = await client.query(
        `select id from jobs
          where kind='storage.reconcile' and dedupe_key=$1 and status in ('queued','running','retry')
          limit 1`,
        [dedupeKey],
      );
      if (existing.rows[0]) return existing.rows[0].id;
      const inserted = await client.query(
        `insert into jobs(tenant_id,kind,execution_class,payload,requested_by,dedupe_key,scheduled_at,max_attempts)
         values(app.current_tenant(),'storage.reconcile','tenant',$1,$2,$3,$4,$5)
         returning id`,
        [
          canonical,
          job.requested_by,
          dedupeKey,
          scheduledAt,
          Math.min(Math.max(maxAttempts, 1), 20),
        ],
      );
      return inserted.rows[0]?.id ?? null;
    });
  }

  async function reconcileStorageObjects(job, payload) {
    const resourceType = String(payload.resourceType ?? "");
    const resourceId = String(payload.resourceId ?? "");
    const policy = String(payload.policy ?? "");
    const candidateKeys = parseStoredArray(
      payload.candidateKeys,
      "storage reconciliation candidateKeys",
      100_000,
    )
      .filter((key) => typeof key === "string")
      .map((key) => key.trim());
    if (!resourceId || !["attachment", "import-batch"].includes(resourceType))
      throw new PermanentJobError("storage reconciliation resource is invalid");
    if (!["orphan-only", "cleanup-candidates", "expiry"].includes(policy))
      throw new PermanentJobError("storage reconciliation policy is invalid");
    if (candidateKeys.length < 1 || candidateKeys.length > 8)
      throw new PermanentJobError("storage reconciliation candidates are invalid");

    const storage = objectStorage();
    if (resourceType === "attachment") {
      const row = await withTenantMaintenance(job.tenant_id, async (client) => {
        const found = await client.query(
          `select id,entity_type,entity_id,object_key,status,deleted_at
             from attachments where id=$1 for update`,
          [resourceId],
        );
        const current = found.rows[0] ?? null;
        if (policy === "expiry" && current?.status === "quarantine") {
          const expired = await client.query(
            `update attachments
                set status='deleted',deleted_at=coalesce(deleted_at,now()),updated_at=now()
              where id=$1 and status='quarantine' and object_key=$2
              returning id,entity_type,entity_id,object_key,status,deleted_at`,
            [resourceId, current.object_key],
          );
          return expired.rows[0] ?? current;
        }
        if (policy === "expiry" && current?.status === "scanning")
          throw new RetryableJobError("attachment scan is still active", 3600);
        return current;
      });

      if (row?.status === "scanning" && policy === "orphan-only")
        throw new RetryableJobError("attachment scan is still active", 3600);
      const entityType = String(row?.entity_type ?? payload.entityType ?? "");
      const entityId = String(row?.entity_id ?? payload.entityId ?? "");
      if (!entityType || !entityId)
        throw new PermanentJobError("storage reconciliation lacks attachment identity");
      for (const key of candidateKeys) {
        if (!attachmentCandidateKey(job.tenant_id, entityType, entityId, resourceId, key))
          throw new PermanentJobError(
            "storage reconciliation attachment key is outside its resource namespace",
          );
      }
      const protectedKey =
        row && ["quarantine", "scanning", "available"].includes(row.status)
          ? String(row.object_key)
          : null;
      let removed = 0;
      for (const key of candidateKeys) {
        if (key === protectedKey) continue;
        await storage.delete(key);
        removed += 1;
      }
      return { resourceType, resourceId, removed, protected: protectedKey ? 1 : 0 };
    }

    const row = await withTenantMaintenance(job.tenant_id, async (client) => {
      const found = await client.query(
        `select id,object_key,status,expires_at from import_batches where id=$1 for update`,
        [resourceId],
      );
      const current = found.rows[0] ?? null;
      if (!current) return null;
      if (policy === "expiry") {
        const expired = new Date(current.expires_at).getTime() <= Date.now();
        if (!expired)
          throw new RetryableJobError("import batch retention window is still active", 3600);
        if (["queued", "running"].includes(current.status))
          throw new RetryableJobError("import batch processing is still active", 3600);
        if (current.status !== "expired") {
          const changed = await client.query(
            `update import_batches set status='expired',updated_at=now()
              where id=$1 and status in ('uploading','completed','failed','cancelled')
              returning id,object_key,status,expires_at`,
            [resourceId],
          );
          return changed.rows[0] ?? current;
        }
      }
      return current;
    });
    for (const key of candidateKeys) {
      if (!importCandidateKey(job.tenant_id, resourceId, key))
        throw new PermanentJobError(
          "storage reconciliation import key is outside its resource namespace",
        );
    }
    const protectedKey =
      row && ["uploading", "queued", "running"].includes(row.status)
        ? String(row.object_key)
        : null;
    let removed = 0;
    for (const key of candidateKeys) {
      if (key === protectedKey) continue;
      await storage.delete(key);
      removed += 1;
    }
    return { resourceType, resourceId, removed, protected: protectedKey ? 1 : 0 };
  }

  async function scanDocument(job, payload) {
    const attachmentId = String(payload.attachmentId ?? "");
    if (!attachmentId) throw new PermanentJobError("attachmentId is required");
    const metadata = await withTenantSnapshot(job.tenant_id, async (client) => {
      const result = await client.query(
        `select id,entity_type,entity_id,object_key,filename,mime_type,size_bytes,status
           from attachments where id=$1 and deleted_at is null`,
        [attachmentId],
      );
      const row = result.rows[0];
      if (!row) throw new PermanentJobError("attachment not found");
      if (!["quarantine", "scanning"].includes(row.status)) return { ...row, skip: true };
      await assertRequesterEligible(client, job.requested_by, ["documents.manage"], false);
      if (!String(row.object_key).includes("/quarantine/"))
        throw new PermanentJobError("attachment is outside the upload quarantine namespace");
      return row;
    });
    if (metadata.skip) return { skipped: true, status: metadata.status };

    const storage = objectStorage();
    const quarantineKey = String(metadata.object_key);
    const bytes = await storage.get(quarantineKey);
    if (bytes.byteLength !== Number(metadata.size_bytes))
      throw new PermanentJobError("stored object size differs from attachment metadata");
    const scan = await malwareScanner().scan({
      filename: metadata.filename,
      mimeType: metadata.mime_type,
      bytes,
    });
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (scan.verdict === "error")
      throw new Error(scan.detail ?? "malware scanner returned an error");
    const clean = scan.verdict === "clean";

    let promotedKey = null;
    if (clean) {
      promotedKey = tenantPromotedObjectKey({
        tenantId: job.tenant_id,
        entityType: metadata.entity_type,
        entityId: metadata.entity_id,
        attachmentId,
        filename: metadata.filename,
        sha256: digest,
      });
      await queueStorageReconcileJob(
        job,
        {
          resourceType: "attachment",
          resourceId: attachmentId,
          policy: "orphan-only",
          candidateKeys: [promotedKey],
          entityType: metadata.entity_type,
          entityId: metadata.entity_id,
        },
        new Date(Date.now() + 24 * 60 * 60 * 1000),
        20,
      );
      await storage.put(promotedKey, bytes, metadata.mime_type);
      const promoted = await storage.head(promotedKey);
      if (
        !promoted ||
        promoted.size !== bytes.byteLength ||
        mediaType(promoted.contentType) !== String(metadata.mime_type).toLowerCase()
      )
        throw new Error("promoted attachment failed object-store integrity verification");
    }

    const changed = await withTenantWrite(job.tenant_id, async (client) => {
      const result = await client.query(
        `update attachments
            set status=$2,object_key=case when $2='available' then $6 else object_key end,
                sha256=$3,scan_provider=$4,scan_result=$5,scanned_at=now(),
                available_at=case when $2='available' then now() else null end,updated_at=now()
          where id=$1 and object_key=$7 and status in ('quarantine','scanning')
          returning id`,
        [
          attachmentId,
          clean ? "available" : "rejected",
          digest,
          scan.provider,
          (scan.detail ?? scan.verdict).slice(0, 1000),
          promotedKey,
          quarantineKey,
        ],
      );
      if (result.rowCount !== 1) return false;
      await client.query(
        `insert into outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload)
         values(app.current_tenant(),$1,'attachment',$2,$3)`,
        [
          clean ? "AttachmentAvailable" : "AttachmentRejected",
          attachmentId,
          JSON.stringify({ sha256: digest, verdict: scan.verdict }),
        ],
      );
      await client.query(
        `insert into jobs(tenant_id,kind,execution_class,payload,requested_by,dedupe_key,scheduled_at,max_attempts)
         values(app.current_tenant(),'outbox.dispatch','tenant','{}',null,$1,now(),8)
         on conflict do nothing`,
        [`outbox-attachment:${attachmentId}`],
      );
      return true;
    });

    if (changed) {
      await queueStorageReconcileJob(job, {
        resourceType: "attachment",
        resourceId: attachmentId,
        policy: "cleanup-candidates",
        candidateKeys: [quarantineKey],
        entityType: metadata.entity_type,
        entityId: metadata.entity_id,
      });
    }
    if (!changed) return { skipped: true, status: "changed-before-promotion" };
    return { status: clean ? "available" : "rejected", sha256: digest, provider: scan.provider };
  }

  return { queueStorageReconcileJob, reconcileStorageObjects, scanDocument };
}

function attachmentCandidateKey(tenantId, entityType, entityId, attachmentId, key) {
  const tenant = safeObjectKeyPart(tenantId);
  const entity = safeObjectKeyPart(entityType);
  const entityKey = safeObjectKeyPart(entityId);
  const attachment = safeObjectKeyPart(attachmentId);
  const quarantine = `tenant/${tenant}/quarantine/${entity}/${entityKey}/${attachment}/`;
  const server = `tenant/${tenant}/objects/server/${entity}/${entityKey}/${attachment}/`;
  if (key.startsWith(quarantine) || key.startsWith(server)) return true;
  const prefix = `tenant/${tenant}/objects/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length).split("/");
  return (
    /^[0-9a-f]{64}$/.test(rest[0] ?? "") &&
    rest[1] === entity &&
    rest[2] === entityKey &&
    rest[3] === attachment &&
    rest.length >= 5
  );
}

function importCandidateKey(tenantId, batchId, key) {
  const tenant = safeObjectKeyPart(tenantId);
  const batch = safeObjectKeyPart(batchId);
  return (
    key.startsWith(`tenant/${tenant}/imports/quarantine/${batch}/`) ||
    key.startsWith(`tenant/${tenant}/imports/objects/${batch}/`)
  );
}

function mediaType(value) {
  return String(value ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}
