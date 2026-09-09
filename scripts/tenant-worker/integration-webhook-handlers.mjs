import { createHash, createHmac } from "node:crypto";
import { pinnedPublicHttpsRequest } from "../../src/lib/integrations/webhook-endpoint.ts";
import { decryptIntegrationSecret } from "../../src/lib/security/integration-secret.ts";
import { errorMessage, PermanentJobError, RetryableJobError } from "../lib/job-errors.mjs";
import { parseStoredObject } from "../lib/stored-json.mjs";

/** Outbound webhook + enterprise integration handlers. */
export function createIntegrationWebhookHandlers({ withTenantWrite, assertRequesterEligible }) {
  async function deliverWebhook(job, payload) {
    const deliveryId = String(payload.deliveryId ?? "");
    if (!deliveryId) throw new PermanentJobError("deliveryId is required");
    const material = await withTenantWrite(job.tenant_id, async (client) => {
      const result = await client.query(
        `select d.id,d.attempt,d.status delivery_status,s.status subscription_status,s.deleted_at subscription_deleted_at,
                s.endpoint,s.secret_encrypted,e.id event_id,e.event_type,e.aggregate_type,e.aggregate_id,e.payload,e.occurred_at
           from webhook_deliveries d
           join webhook_subscriptions s on s.id=d.subscription_id and s.tenant_id=d.tenant_id
           join outbox_events e on e.id=d.event_id and e.tenant_id=d.tenant_id
          where d.id=$1 and d.status in ('queued','retry','delivering')
          for update`,
        [deliveryId],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.subscription_status !== "active" || row.subscription_deleted_at) {
        await client.query(
          `update webhook_deliveries
              set status='dead_letter',next_attempt_at=null,error='webhook subscription is inactive',updated_at=now()
            where id=$1`,
          [deliveryId],
        );
        return { inactive: true };
      }
      const updated = await client.query(
        `update webhook_deliveries set status='delivering',attempt=attempt+1,next_attempt_at=null,updated_at=now()
          where id=$1 returning attempt`,
        [deliveryId],
      );
      return { ...row, attempt: Number(updated.rows[0]?.attempt ?? Number(row.attempt) + 1) };
    });
    if (!material) return { skipped: true };
    if (material.inactive) return { skipped: true, status: "dead_letter" };

    const body = JSON.stringify({
      id: material.event_id,
      type: material.event_type,
      aggregate: { type: material.aggregate_type, id: material.aggregate_id },
      occurredAt: material.occurred_at,
      payload: parseStoredObject(material.payload, "outbox event payload"),
    });
    const secret = decryptIntegrationSecret(material.secret_encrypted);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

    let response;
    try {
      response = await pinnedPublicHttpsRequest(material.endpoint, {
        method: "POST",
        timeoutMs: 15_000,
        maxResponseBytes: 64 * 1024,
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          "user-agent": "univ-web-webhook/1",
          "x-univ-event": material.event_type,
          "x-univ-delivery": deliveryId,
          "x-univ-timestamp": timestamp,
          "x-univ-signature": `v1=${signature}`,
        },
        body,
      });
    } catch (error) {
      await recordWebhookRetry(job.tenant_id, deliveryId, material.attempt, errorMessage(error));
      throw new RetryableJobError(errorMessage(error), webhookRetryDelay(material.attempt));
    }

    const excerpt = Buffer.from(response.body).toString("utf8").slice(0, 500);
    if (response.ok) {
      await withTenantWrite(job.tenant_id, (client) =>
        client.query(
          `update webhook_deliveries
              set status='delivered',delivered_at=now(),next_attempt_at=null,response_status=$2,response_excerpt=$3,error=null,updated_at=now()
            where id=$1 and status='delivering'`,
          [deliveryId, response.status, excerpt],
        ),
      );
      return { delivered: true, status: response.status };
    }

    const detail = `webhook HTTP ${response.status}: ${excerpt}`;
    const retryableStatus =
      [408, 409, 425, 429].includes(response.status) || response.status >= 500;
    if (!retryableStatus || material.attempt >= 8) {
      await withTenantWrite(job.tenant_id, (client) =>
        client.query(
          `update webhook_deliveries
              set status='dead_letter',next_attempt_at=null,response_status=$2,response_excerpt=$3,error=$4,updated_at=now()
            where id=$1`,
          [deliveryId, response.status, excerpt, detail.slice(0, 1000)],
        ),
      );
      throw new PermanentJobError(detail);
    }

    await recordWebhookRetry(
      job.tenant_id,
      deliveryId,
      material.attempt,
      detail,
      response.status,
      excerpt,
    );
    throw new RetryableJobError(detail, webhookRetryDelay(material.attempt));
  }

  function webhookRetryDelay(attempt) {
    return Math.min(3600, 30 * 2 ** Math.max(0, Number(attempt) - 1));
  }

  async function recordWebhookRetry(
    tenantId,
    deliveryId,
    attempt,
    detail,
    status = null,
    excerpt = null,
  ) {
    if (Number(attempt) >= 8) {
      await withTenantWrite(tenantId, (client) =>
        client.query(
          `update webhook_deliveries
              set status='dead_letter',next_attempt_at=null,response_status=$2,response_excerpt=$3,error=$4,updated_at=now()
            where id=$1`,
          [deliveryId, status, excerpt, detail.slice(0, 1000)],
        ),
      );
      throw new PermanentJobError(detail);
    }
    const delay = webhookRetryDelay(attempt);
    await withTenantWrite(tenantId, (client) =>
      client.query(
        `update webhook_deliveries
            set status='retry',next_attempt_at=now()+($2::int*interval '1 second'),response_status=$3,response_excerpt=$4,error=$5,updated_at=now()
          where id=$1`,
        [deliveryId, delay, status, excerpt, detail.slice(0, 1000)],
      ),
    );
  }

  async function runIntegrationSync(job, payload, heartbeat) {
    const runId = String(payload.runId ?? "");
    const connectionId = String(payload.connectionId ?? "");
    if (!runId || !connectionId)
      throw new PermanentJobError("integration sync requires runId and connectionId");
    let material;
    try {
      material = await withTenantWrite(job.tenant_id, async (client) => {
        const run = (
          await client.query(
            `select id,connection_id,job_id,requested_by,kind,status,received,staged,error_count
               from integration_sync_runs where id=$1 for update`,
            [runId],
          )
        ).rows[0];
        if (!run) throw new PermanentJobError("integration sync run was not found");
        if (
          String(run.connection_id) !== connectionId ||
          String(run.job_id ?? "") !== String(job.id) ||
          String(run.requested_by) !== String(job.requested_by)
        )
          throw new PermanentJobError("integration sync run does not belong to this job");
        if (run.status === "completed") {
          return {
            reconciled: true,
            kind: run.kind,
            received: Number(run.received ?? 0),
            staged: Number(run.staged ?? 0),
            errors: Number(run.error_count ?? 0),
          };
        }
        if (!["queued", "running", "failed"].includes(run.status))
          throw new PermanentJobError(`integration sync cannot run from status ${run.status}`);

        await assertRequesterEligible(client, job.requested_by, ["integrations.manage"], false);
        const result = await client.query(
          `select id,kind,name,config_encrypted,status from integration_connections where id=$1 and deleted_at is null`,
          [connectionId],
        );
        const row = result.rows[0];
        if (
          row?.status !== "active" ||
          !["sis", "hr", "identity_ldap"].includes(row.kind) ||
          row.kind !== run.kind
        )
          throw new PermanentJobError("active system integration was not found");
        const started = await client.query(
          `update integration_sync_runs
              set status='running',started_at=coalesce(started_at,now()),completed_at=null,public_error=null,updated_at=now()
            where id=$1 and connection_id=$2 and job_id=$3 and requested_by=$4 returning id`,
          [runId, connectionId, job.id, job.requested_by],
        );
        if (started.rowCount !== 1)
          throw new PermanentJobError("integration sync run lost ownership");
        return { ...row, reconciled: false };
      });

      if (material.reconciled) {
        return {
          runId,
          connectionId,
          kind: material.kind,
          received: material.received,
          staged: material.staged,
          errors: material.errors,
          reconciled: true,
        };
      }

      const config = JSON.parse(decryptIntegrationSecret(material.config_encrypted));
      const records =
        material.kind === "identity_ldap"
          ? await pullLdapRecords(config, heartbeat)
          : await pullHttpsSystemRecords(material.kind, config, heartbeat);
      let staged = 0;
      const errors = [];
      for (let offset = 0; offset < records.length; offset += 250) {
        await heartbeat();
        const batch = records.slice(offset, offset + 250);
        await withTenantWrite(job.tenant_id, async (client) => {
          for (const record of batch) {
            try {
              const payloadJson = JSON.stringify(record.payload);
              const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
              await client.query(
                `insert into integration_staging_records(tenant_id,run_id,connection_id,source_key,entity_type,payload_json,payload_hash,status)
                 values(app.current_tenant(),$1,$2,$3,$4,$5,$6,'pending')
                 on conflict(tenant_id,connection_id,source_key) do update
                   set run_id=excluded.run_id,entity_type=excluded.entity_type,payload_json=excluded.payload_json,
                       payload_hash=excluded.payload_hash,
                       status=case when integration_staging_records.payload_hash=excluded.payload_hash then integration_staging_records.status else 'pending' end,
                       updated_at=now()`,
                [
                  runId,
                  connectionId,
                  record.sourceKey,
                  record.entityType,
                  payloadJson,
                  payloadHash,
                ],
              );
              staged += 1;
            } catch (error) {
              errors.push(errorMessage(error).slice(0, 300));
            }
          }
        });
      }
      await withTenantWrite(job.tenant_id, async (client) => {
        const completed = await client.query(
          `update integration_sync_runs
              set status='completed',received=$2,staged=$3,error_count=$4,public_error=null,completed_at=now(),updated_at=now()
            where id=$1 and job_id=$5 and status='running' returning id`,
          [runId, records.length, staged, errors.length, job.id],
        );
        if (completed.rowCount !== 1) {
          const current = await client.query(
            `select status from integration_sync_runs where id=$1 and job_id=$2`,
            [runId, job.id],
          );
          if (current.rows[0]?.status !== "completed")
            throw new Error("integration sync run lost its running state before completion");
        }
        await client.query(
          `update integration_connections set last_sync_at=now(),last_error=$2,updated_at=now() where id=$1`,
          [connectionId, errors.length ? errors[0] : null],
        );
      });
      return {
        runId,
        connectionId,
        kind: material.kind,
        received: records.length,
        staged,
        errors: errors.length,
      };
    } catch (error) {
      await withTenantWrite(job.tenant_id, async (client) => {
        const failed = await client.query(
          `update integration_sync_runs
              set status='failed',error_count=error_count+1,public_error=$3,completed_at=now(),updated_at=now()
            where id=$1 and job_id=$2 and status<>'completed' returning id`,
          [runId, job.id, errorMessage(error).slice(0, 500)],
        );
        if (failed.rowCount === 1) {
          await client.query(
            `update integration_connections set last_error=$2,updated_at=now() where id=$1`,
            [connectionId, errorMessage(error).slice(0, 1000)],
          );
        }
      }).catch(() => {});
      throw error;
    }
  }

  return { deliverWebhook, runIntegrationSync };
}

async function pullHttpsSystemRecords(kind, config, heartbeat) {
  if (typeof config.endpoint !== "string" || typeof config.secret !== "string" || !config.secret)
    throw new PermanentJobError("system API configuration is incomplete");
  await heartbeat();
  const response = await pinnedPublicHttpsRequest(config.endpoint, {
    method: "GET",
    timeoutMs: 30_000,
    maxResponseBytes: 10 * 1024 * 1024,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.secret}`,
      "user-agent": "univ-web-integration/1",
    },
  });
  if (!response.ok) throw new Error(`integration HTTP ${response.status}`);
  const text = Buffer.from(response.body).toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PermanentJobError("integration response is not JSON");
  }
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed?.data)
        ? parsed.data
        : null;
  if (!items)
    throw new PermanentJobError("integration JSON must be an array or contain items/data array");
  if (items.length > 50_000)
    throw new PermanentJobError("integration response exceeds 50,000 records");
  return items.map((raw, index) => {
    const payload = normaliseExternalValue(raw);
    return {
      sourceKey: externalSourceKey(payload, index),
      entityType: kind === "sis" ? "student" : "employee",
      payload,
    };
  });
}

async function pullLdapRecords(config, heartbeat) {
  if (
    typeof config.endpoint !== "string" ||
    typeof config.identifier !== "string" ||
    typeof config.secret !== "string" ||
    typeof config.baseDn !== "string"
  )
    throw new PermanentJobError("LDAP configuration is incomplete");
  const url = new URL(config.endpoint);
  if (url.protocol !== "ldaps:") throw new PermanentJobError("LDAP adapter requires LDAPS");
  const allowed = new Set(
    String(process.env.ENTERPRISE_LDAP_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowed.has(url.hostname.toLowerCase()))
    throw new PermanentJobError("LDAP host is not present in ENTERPRISE_LDAP_ALLOWED_HOSTS");
  const { Client } = await import("ldapts");
  const client = new Client({
    url: url.toString(),
    timeout: 30_000,
    connectTimeout: 10_000,
    tlsOptions: { minVersion: "TLSv1.2" },
    strictDN: true,
  });
  try {
    await client.bind(config.identifier, config.secret);
    await heartbeat();
    const usernameAttribute =
      typeof config.usernameAttribute === "string" && config.usernameAttribute
        ? config.usernameAttribute
        : "sAMAccountName";
    const result = await client.search(config.baseDn, {
      scope: "sub",
      filter: "(&(objectClass=person)(objectClass=user))",
      attributes: [
        usernameAttribute,
        "cn",
        "displayName",
        "mail",
        "employeeNumber",
        "objectGUID",
        "entryUUID",
      ],
      sizeLimit: 50_000,
      paged: { pageSize: 500, pagePause: false },
    });
    if (result.searchEntries.length >= 50_000)
      throw new PermanentJobError("LDAP result reached 50,000 record safety limit");
    return result.searchEntries.map((entry, index) => {
      const payload = normaliseExternalValue(entry);
      return {
        sourceKey: externalSourceKey(payload, index, [
          "objectGUID",
          "entryUUID",
          "employeeNumber",
          usernameAttribute,
        ]),
        entityType: "directory_user",
        payload,
      };
    });
  } finally {
    await client.unbind().catch(() => {});
  }
}

function externalSourceKey(
  payload,
  index,
  keys = ["id", "externalId", "studentNumber", "employeeNumber", "username", "userName"],
) {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return `${key}:${value.trim().slice(0, 240)}`;
  }
  return `row:${index + 1}:${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 24)}`;
}

function normaliseExternalValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("base64url");
  if (Array.isArray(value)) return value.slice(0, 100).map(normaliseExternalValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 200))
      out[String(key).slice(0, 120)] = normaliseExternalValue(item);
    return out;
  }
  if (["string", "number", "boolean"].includes(typeof value) || value === null)
    return typeof value === "string" ? value.slice(0, 4000) : value;
  return String(value ?? "").slice(0, 4000);
}
