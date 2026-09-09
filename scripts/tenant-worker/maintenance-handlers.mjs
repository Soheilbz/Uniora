import {
  calculateNextScheduledOccurrence,
  parseScheduleSpec,
} from "../../src/lib/scheduling-core.ts";
import { PermanentJobError } from "../lib/job-errors.mjs";
import { parseStoredArray } from "../lib/stored-json.mjs";

/** Scheduled, analytics, outbox and retention handlers. */
export function createMaintenanceHandlers({
  control,
  withTenantSnapshot,
  withTenantWrite,
  assertRequesterEligible,
  errorMessage,
}) {
  async function refreshAnalytics(job) {
    return withTenantWrite(job.tenant_id, async (client) => {
      const students = await client.query(
        `select count(*)::int c from students where deleted_at is null`,
      );
      const professors = await client.query(
        `select count(*)::int c from professors where deleted_at is null`,
      );
      const council = await client.query(
        `select count(*)::int c from council_decisions where deleted_at is null`,
      );
      const workshops = await client.query(
        `select count(*)::int c from workshops where deleted_at is null`,
      );
      const tasks = await client.query(
        `select count(*)::int c from tasks where deleted_at is null and status not in ('completed','cancelled')`,
      );
      const payload = {
        students: Number(students.rows[0]?.c ?? 0),
        professors: Number(professors.rows[0]?.c ?? 0),
        councilDecisions: Number(council.rows[0]?.c ?? 0),
        workshops: Number(workshops.rows[0]?.c ?? 0),
        openTasks: Number(tasks.rows[0]?.c ?? 0),
      };
      await client.query(
        `insert into reporting_snapshots(tenant_id,projection,period_key,payload_json,calculated_at)
         values(app.current_tenant(),'dashboard','current',$1,now())
         on conflict (tenant_id,projection,period_key) do update
           set payload_json=excluded.payload_json,calculated_at=excluded.calculated_at,updated_at=now()`,
        [JSON.stringify(payload)],
      );
      return payload;
    });
  }

  async function deliverScheduledReminder(job, payload) {
    const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 180) : "";
    if (!title) throw new PermanentJobError("scheduled reminder title is required");
    const body =
      typeof payload.body === "string" ? payload.body.trim().slice(0, 1000) || null : null;
    const href =
      typeof payload.href === "string" && payload.href.startsWith("/")
        ? payload.href.slice(0, 500)
        : null;
    const severity = ["info", "success", "warning", "error"].includes(payload.severity)
      ? payload.severity
      : "info";
    return withTenantWrite(job.tenant_id, async (client) => {
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `scheduled-reminder:${job.id}`,
      ]);
      const existing = await client.query(
        `select id from notifications
          where source_event_id=$1 and kind='scheduled.reminder' and user_id=$2
          order by created_at limit 1`,
        [job.id, job.requested_by],
      );
      if (existing.rows[0]) return { notificationId: existing.rows[0].id, reconciled: true };
      await assertRequesterEligible(client, job.requested_by, ["reports.schedule"], false);
      const inserted = await client.query(
        `insert into notifications(tenant_id,user_id,kind,title,body,href,severity,source_event_id)
         values(app.current_tenant(),$1,'scheduled.reminder',$2,$3,$4,$5,$6)
         returning id`,
        [job.requested_by, title, body, href, severity, job.id],
      );
      return { notificationId: inserted.rows[0]?.id ?? null };
    });
  }

  async function dispatchSchedules(job) {
    return withTenantWrite(job.tenant_id, async (client) => {
      const due = await client.query(
        `select * from scheduled_jobs where enabled=true and next_run_at<=now() and deleted_at is null order by next_run_at for update skip locked limit 50`,
      );
      let queued = 0;
      for (const schedule of due.rows) {
        const dueAt = new Date(schedule.next_run_at);
        if (Number.isNaN(dueAt.getTime()))
          throw new PermanentJobError(`invalid next_run_at for schedule ${schedule.id}`);
        const inserted = await client.query(
          `insert into jobs(tenant_id,kind,execution_class,payload,requested_by,dedupe_key,scheduled_at)
           values(app.current_tenant(),$1,'tenant',$2,$3,$4,now())
           on conflict do nothing returning id`,
          [
            schedule.kind,
            schedule.payload,
            schedule.created_by,
            `schedule:${schedule.id}:${dueAt.toISOString()}`,
          ],
        );
        const nextRunAt = nextScheduledOccurrence(
          schedule.schedule,
          schedule.timezone,
          dueAt,
          new Date(),
        );
        await client.query(
          `update scheduled_jobs
              set last_run_at=$2,next_run_at=$3,
                  enabled=case when $3::timestamptz is null then false else enabled end,
                  version=version+1,updated_at=now()
            where id=$1`,
          [schedule.id, dueAt.toISOString(), nextRunAt?.toISOString() ?? null],
        );
        if (inserted.rowCount === 1) queued += 1;
      }
      const next = await client.query(
        `select next_run_at,created_by from scheduled_jobs
          where enabled=true and next_run_at is not null and deleted_at is null
          order by next_run_at,id limit 1`,
      );
      const nextDue = next.rows[0];
      if (nextDue?.next_run_at && nextDue?.created_by) {
        const nextDueAt = new Date(nextDue.next_run_at);
        if (!Number.isNaN(nextDueAt.getTime())) {
          await client.query(
            `insert into jobs(tenant_id,kind,execution_class,payload,requested_by,dedupe_key,scheduled_at,max_attempts)
             values(app.current_tenant(),'schedule.dispatch','tenant','{}',$1,$2,$3,8)
             on conflict do nothing`,
            [
              nextDue.created_by,
              `schedule-dispatch:${nextDueAt.toISOString()}`,
              nextDueAt.toISOString(),
            ],
          );
        }
      }
      return { queued, examined: due.rowCount, nextDispatchAt: nextDue?.next_run_at ?? null };
    });
  }

  function nextScheduledOccurrence(rawSchedule, timezone, previousDueAt, now) {
    try {
      const spec = parseScheduleSpec(String(rawSchedule ?? ""));
      return calculateNextScheduledOccurrence(spec, String(timezone || "UTC"), previousDueAt, now);
    } catch (error) {
      throw new PermanentJobError(`invalid scheduled job recurrence: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  async function dispatchOutbox(job) {
    return withTenantWrite(job.tenant_id, async (client) => {
      const events = await client.query(
        `select id,event_type from outbox_events where published_at is null and available_at<=now() order by occurred_at,id for update skip locked limit 100`,
      );
      let deliveries = 0;
      for (const event of events.rows) {
        const subs = await client.query(
          `select id,event_types from webhook_subscriptions where status='active' and deleted_at is null`,
        );
        for (const sub of subs.rows) {
          const types = parseStoredArray(
            sub.event_types,
            "webhook subscription event types",
            100_000,
          );
          if (!types.includes(event.event_type) && !types.includes("*")) continue;
          const inserted = await client.query(
            `insert into webhook_deliveries(tenant_id,subscription_id,event_id,status,next_attempt_at)
             values(app.current_tenant(),$1,$2,'queued',now()) on conflict do nothing returning id`,
            [sub.id, event.id],
          );
          const deliveryId = inserted.rows[0]?.id;
          if (deliveryId) {
            await client.query(
              `insert into jobs(tenant_id,kind,execution_class,payload,requested_by,dedupe_key,scheduled_at,max_attempts)
               values(app.current_tenant(),'webhook.deliver','tenant',$1,$2,$3,now(),8) on conflict do nothing`,
              [JSON.stringify({ deliveryId }), job.requested_by, `webhook:${deliveryId}`],
            );
            deliveries += 1;
          }
        }
        await client.query(
          `update outbox_events set published_at=now(),updated_at=now() where id=$1`,
          [event.id],
        );
      }
      const more = await client.query(
        `select 1 from outbox_events where published_at is null and available_at<=now() limit 1`,
      );
      if (more.rowCount) {
        await client.query(
          `insert into jobs(tenant_id,kind,execution_class,payload,requested_by,dedupe_key,scheduled_at,max_attempts)
           values(app.current_tenant(),'outbox.dispatch','tenant','{}',null,$1,now(),8) on conflict do nothing`,
          [`outbox-drain:${job.id}`],
        );
      }
      return { events: events.rowCount, deliveries, continued: Boolean(more.rowCount) };
    });
  }

  async function runRetentionPurge(job, payload) {
    const dryRun = payload.dryRun !== false;
    const policies = await withTenantSnapshot(job.tenant_id, async (client) => {
      await assertRequesterEligible(client, job.requested_by, ["retention.manage"], false);
      const result = await client.query(
        `select resource,retain_days,mode from retention_policies where enabled=true and legal_hold=false order by resource`,
      );
      return result.rows;
    });

    const tenantPolicies = policies.filter(
      (policy) => RETENTION_PURGE_SPECS[policy.resource]?.authority === "tenant",
    );
    const tenantResults = await withTenantWrite(job.tenant_id, async (client) => {
      const results = [];
      for (const policy of tenantPolicies) {
        const spec = RETENTION_PURGE_SPECS[policy.resource];
        results.push(await applyTenantRetentionPolicy(client, policy, spec, dryRun));
      }
      return results;
    });

    const controlResults = [];
    for (const policy of policies) {
      const spec = RETENTION_PURGE_SPECS[policy.resource];
      if (!spec) {
        controlResults.push({ resource: policy.resource, affected: 0, skipped: "unsupported" });
        continue;
      }
      if (spec.authority !== "control") continue;
      controlResults.push(await applyControlRetentionPolicy(job.tenant_id, policy, spec, dryRun));
    }
    const byResource = new Map(
      [...tenantResults, ...controlResults].map((result) => [result.resource, result]),
    );
    return {
      dryRun,
      results: policies.map(
        (policy) =>
          byResource.get(policy.resource) ?? {
            resource: policy.resource,
            affected: 0,
            skipped: policy.mode === "purge" ? "unsupported" : "archive-mode",
          },
      ),
    };
  }

  async function applyTenantRetentionPolicy(client, policy, spec, dryRun) {
    if (policy.mode !== "purge")
      return { resource: policy.resource, affected: 0, skipped: "archive-mode" };
    const where = `(${spec.predicate}) and ${spec.timestamp} < now()-($1::int*interval '1 day')`;
    const count = await client.query(`select count(*)::int c from ${spec.table} where ${where}`, [
      policy.retain_days,
    ]);
    const affected = Number(count.rows[0]?.c ?? 0);
    if (!dryRun && affected)
      await client.query(`delete from ${spec.table} where ${where}`, [policy.retain_days]);
    return { resource: policy.resource, affected };
  }

  async function applyControlRetentionPolicy(tenantId, policy, spec, dryRun) {
    if (policy.mode !== "purge")
      return { resource: policy.resource, affected: 0, skipped: "archive-mode" };
    const where = `tenant_id=$1 and (${spec.predicate}) and ${spec.timestamp} < now()-($2::int*interval '1 day')`;
    const count = await control.query(`select count(*)::int c from ${spec.table} where ${where}`, [
      tenantId,
      policy.retain_days,
    ]);
    const affected = Number(count.rows[0]?.c ?? 0);
    if (!dryRun && affected)
      await control.query(`delete from ${spec.table} where ${where}`, [
        tenantId,
        policy.retain_days,
      ]);
    return { resource: policy.resource, affected };
  }

  return {
    refreshAnalytics,
    deliverScheduledReminder,
    dispatchSchedules,
    dispatchOutbox,
    runRetentionPurge,
  };
}

const RETENTION_PURGE_SPECS = Object.freeze({
  notifications: Object.freeze({
    authority: "tenant",
    table: "notifications",
    timestamp: "created_at",
    predicate: "true",
  }),
  recent_records: Object.freeze({
    authority: "tenant",
    table: "recent_records",
    timestamp: "opened_at",
    predicate: "true",
  }),
  quality_snapshots: Object.freeze({
    authority: "tenant",
    table: "quality_snapshots",
    timestamp: "captured_at",
    predicate: "true",
  }),
  webhook_deliveries: Object.freeze({
    authority: "tenant",
    table: "webhook_deliveries",
    timestamp: "created_at",
    predicate: "status in ('delivered','dead_letter')",
  }),
  job_attempts: Object.freeze({
    authority: "control",
    table: "job_attempts",
    timestamp: "completed_at",
    predicate: "completed_at is not null",
  }),
  api_rate_windows: Object.freeze({
    authority: "tenant",
    table: "api_rate_windows",
    timestamp: "window_started_at",
    predicate: "true",
  }),
});
