import { rmSync } from "node:fs";
import { parseExportArtifactResult } from "../../src/lib/jobs/export-artifact.ts";
import { errorMessage, PermanentJobError } from "../lib/job-errors.mjs";

/**
 * Durable queue ownership for the tenant worker.
 *
 * All claim/lease/publication mutations live here so a handler cannot publish
 * outside the attempt fencing contract by accident. Domain handlers receive a
 * heartbeat closure, never the control database itself.
 */
export function createTenantJobControlPlane({
  control,
  workerId,
  operator,
  leaseSeconds,
  heartbeatMs,
  cleanupJobFiles,
  artifactFile,
  platformAudit,
  onLeaseRecovered = () => {},
}) {
  async function claimOne() {
    const client = await control.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `with picked as (
           select id from jobs
            where execution_class='tenant'
              and status in ('queued','retry')
              and scheduled_at <= now()
            order by scheduled_at, created_at, id
            for update skip locked
            limit 1
         )
         update jobs j
            set status='running', attempt=j.attempt+1,
                started_at=coalesce(j.started_at,now()),
                lease_until=now()+($1::int * interval '1 second'),
                heartbeat_at=now(),updated_at=now(),
                error_code=null,public_error=null,private_error=null
           from picked
          where j.id=picked.id
        returning j.*`,
        [leaseSeconds],
      );
      const job = result.rows[0] ?? null;
      if (job) {
        await client.query(
          `insert into job_attempts(tenant_id,job_id,attempt,worker_id)
           values($1,$2,$3,$4)
           on conflict (tenant_id,job_id,attempt) do nothing`,
          [job.tenant_id, job.id, job.attempt, workerId],
        );
      }
      await client.query("commit");
      return job;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function recoverStaleJobs() {
    const client = await control.connect();
    const cleaned = [];
    try {
      await client.query("begin");
      const stale = await client.query(
        `select id,tenant_id,kind,attempt,max_attempts
           from jobs
          where execution_class='tenant' and status='running' and lease_until < now()
          order by lease_until,id
          for update skip locked
          limit 100`,
      );
      for (const row of stale.rows) {
        const next = Number(row.attempt) < Number(row.max_attempts) ? "retry" : "failed";
        const updated = await client.query(
          `update jobs
              set status=$3,
                  scheduled_at=case when $3='retry' then now()+interval '30 seconds' else scheduled_at end,
                  completed_at=case when $3='failed' then now() else null end,
                  error_code='LEASE_EXPIRED',
                  public_error='Background work was interrupted and will be retried when possible.',
                  private_error='worker lease expired',lease_until=null,updated_at=now()
            where id=$1 and status='running' and attempt=$2 and lease_until < now()
            returning id`,
          [row.id, row.attempt, next],
        );
        if (updated.rowCount !== 1) continue;
        await client.query(
          `update job_attempts
              set completed_at=now(),outcome=$4,error_code='LEASE_EXPIRED',error_detail='worker lease expired',updated_at=now()
            where tenant_id=$1 and job_id=$2 and attempt=$3`,
          [row.tenant_id, row.id, row.attempt, next],
        );
        await client.query(
          `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome)
           values($1,'job.lease_expired',$2,$3,$4,'failure')`,
          [
            operator,
            row.tenant_id,
            row.id,
            JSON.stringify({ kind: row.kind, attempt: row.attempt, next }),
          ],
        );
        cleaned.push(row);
        onLeaseRecovered();
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    for (const row of cleaned) cleanupJobFiles(row);
  }

  async function expireArtifacts() {
    const result = await control.query(
      `select id,tenant_id,kind,result,attempt
         from jobs
        where execution_class='tenant' and status='completed' and kind like 'export.%'
          and result is not null and completed_at <= now() - interval '23 hours'
        order by completed_at,id limit 200`,
    );
    for (const row of result.rows) {
      let artifact;
      try {
        artifact = parseExportArtifactResult(row.result);
      } catch (error) {
        cleanupJobFiles(row);
        const changed = await control.query(
          `update jobs
              set status='failed',error_code='EXPORT_METADATA_INVALID',
                  public_error='Export artifact metadata is invalid.',private_error=$2,
                  completed_at=now(),updated_at=now()
            where id=$1 and status='completed' returning id`,
          [row.id, errorMessage(error).slice(0, 4000)],
        );
        if (changed.rowCount === 1) {
          await platformAudit(
            "export.job.metadata_invalid",
            row.tenant_id,
            row.id,
            { kind: row.kind },
            "failure",
          );
        }
        continue;
      }
      if (Date.parse(artifact.expiresAt) > Date.now()) continue;
      rmSync(artifactFile(artifact.artifactPath), { force: true });
      const changed = await control.query(
        `update jobs set status='expired',updated_at=now() where id=$1 and status='completed' returning id`,
        [row.id],
      );
      if (changed.rowCount === 1) {
        await platformAudit("export.job.expired", row.tenant_id, row.id, { kind: row.kind });
      }
    }
  }

  async function publishJobSuccess(job, result) {
    const client = await control.connect();
    try {
      await client.query("begin");
      const published = await client.query(
        `update jobs
            set status='completed',result=$3,completed_at=now(),lease_until=null,heartbeat_at=now(),
                error_code=null,public_error=null,private_error=null,updated_at=now()
          where id=$1 and attempt=$2 and status='running' and lease_until >= now()
          returning id`,
        [job.id, job.attempt, JSON.stringify(result)],
      );
      if (published.rowCount !== 1) {
        const current = await client.query(`select status,attempt from jobs where id=$1`, [job.id]);
        const row = current.rows[0];
        if (row?.status === "completed" && Number(row.attempt) === Number(job.attempt)) {
          await client.query("rollback");
          return;
        }
        throw new Error("job lease was lost before publication");
      }
      await client.query(
        `update job_attempts set completed_at=now(),outcome='completed',error_code=null,error_detail=null,updated_at=now()
          where tenant_id=$1 and job_id=$2 and attempt=$3`,
        [job.tenant_id, job.id, job.attempt],
      );
      await client.query(
        `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome)
         values($1,'job.completed',$2,$3,$4,'success')`,
        [operator, job.tenant_id, job.id, JSON.stringify({ kind: job.kind, attempt: job.attempt })],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function publishJobFailure(job, input) {
    const client = await control.connect();
    try {
      await client.query("begin");
      const next = input.retry ? "retry" : "failed";
      const published = await client.query(
        `update jobs
            set status=$3,
                scheduled_at=case when $3='retry' then now()+($4::int*interval '1 second') else scheduled_at end,
                completed_at=case when $3='failed' then now() else null end,
                lease_until=null,heartbeat_at=now(),error_code=$5,
                public_error='The background operation could not be completed.',private_error=$6,updated_at=now()
          where id=$1 and attempt=$2 and status='running' returning id`,
        [job.id, job.attempt, next, input.delaySeconds, input.errorCode, input.detail],
      );
      if (published.rowCount !== 1) {
        await client.query("rollback");
        return false;
      }
      await client.query(
        `update job_attempts set completed_at=now(),outcome=$4,error_code=$5,error_detail=$6,updated_at=now()
          where tenant_id=$1 and job_id=$2 and attempt=$3`,
        [job.tenant_id, job.id, job.attempt, next, input.errorCode, input.detail],
      );
      await client.query(
        `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome)
         values($1,'job.failed',$2,$3,$4,'failure')`,
        [
          operator,
          job.tenant_id,
          job.id,
          JSON.stringify({
            kind: job.kind,
            attempt: job.attempt,
            retry: input.retry,
            error: input.detail.slice(0, 500),
          }),
        ],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function makeHeartbeat(job) {
    let lastBeat = 0;
    return async (force = false) => {
      const now = Date.now();
      if (!force && now - lastBeat < heartbeatMs) return;
      const result = await control.query(
        `update jobs set heartbeat_at=now(),lease_until=now()+($3::int*interval '1 second'),updated_at=now()
          where id=$1 and attempt=$2 and status='running' and lease_until >= now() returning id`,
        [job.id, job.attempt, leaseSeconds],
      );
      if (result.rowCount !== 1) throw new PermanentJobError("job lease is no longer active");
      lastBeat = now;
    };
  }

  return {
    claimOne,
    recoverStaleJobs,
    expireArtifacts,
    publishJobSuccess,
    publishJobFailure,
    makeHeartbeat,
  };
}
