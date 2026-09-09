/** Tenant projection and data-quality jobs. */
export function createProjectionHandlers({ withTenantWrite }) {
  async function refreshSearchProjection(job) {
    return withTenantWrite(job.tenant_id, async (client) => {
      await client.query(`select app.refresh_search_documents(app.current_tenant())`);
      const count = await client.query(`select count(*)::int as count from search_documents`);
      return { refreshed: true, count: Number(count.rows[0]?.count ?? 0) };
    });
  }

  async function refreshAttentionProjection(job) {
    return withTenantWrite(job.tenant_id, async (client) => {
      const statements = [
        [
          "students.incomplete",
          `select count(*)::int c from students where deleted_at is null and (primary_supervisor_id is null or student_number is null)`,
        ],
        [
          "council.pending",
          `select count(*)::int c from council_decisions where deleted_at is null and workflow_state not in ('finalized','rejected')`,
        ],
        [
          "tasks.overdue",
          `select count(*)::int c from tasks where deleted_at is null and status not in ('completed','cancelled') and due_at < now()`,
        ],
      ];
      const counts = [];
      for (const [category, query] of statements) {
        const result = await client.query(query);
        counts.push([category, Number(result.rows[0]?.c ?? 0)]);
      }
      const users = await client.query(
        `select count(*)::int as count
           from "user"
          where tenant_id=app.current_tenant() and suspended_at is null`,
      );
      let written = 0;
      for (const [category, count] of counts) {
        /*
         * Keep the user selection and insert in one statement, and lock the
         * selected rows for the duration of this tenant transaction. The old
         * implementation selected IDs first, then inserted a large parameter
         * list; a concurrent user retirement could delete one of those IDs in
         * between and turn a routine projection refresh into a foreign-key
         * failure. The worker is a durable projection, so it must tolerate the
         * same concurrent lifecycle changes as the request path.
         */
        const result = await client.query(
          `with active_users as (
             select id
               from "user"
              where tenant_id=app.current_tenant() and suspended_at is null
              for share
           )
           insert into attention_summary(tenant_id,user_id,category,count,last_calculated_at)
           select app.current_tenant(),id,$1,$2,now()
             from active_users
           on conflict (tenant_id,user_id,category) do update
             set count=excluded.count,last_calculated_at=excluded.last_calculated_at,updated_at=now()`,
          [category, count],
        );
        written += result.rowCount ?? 0;
      }
      return { refreshed: true, users: Number(users.rows[0]?.count ?? 0), written };
    });
  }

  async function runQualitySnapshot(job) {
    return withTenantWrite(job.tenant_id, async (client) => {
      const rules = await client.query(
        `select id,code,evaluator from quality_rules where enabled=true and deleted_at is null order by code`,
      );
      let recorded = 0;
      const skipped = [];
      for (const rule of rules.rows) {
        const statement = QUALITY_EVALUATORS[String(rule.evaluator ?? "")];
        if (!statement) {
          skipped.push(String(rule.code));
          continue;
        }
        const started = Date.now();
        const result = await client.query(statement);
        const count = Number(result.rows[0]?.c ?? 0);
        await client.query(
          `insert into quality_snapshots(tenant_id,rule_id,count,sample_entity_ids,duration_ms,captured_at)
           values(app.current_tenant(),$1,$2,'[]',$3,now())`,
          [rule.id, Number.isFinite(count) ? count : 0, Math.max(0, Date.now() - started)],
        );
        recorded += 1;
      }
      return { recorded, skipped };
    });
  }

  return { refreshSearchProjection, refreshAttentionProjection, runQualitySnapshot };
}

const QUALITY_EVALUATORS = Object.freeze({
  "students.missing_supervisor": `select count(*)::int c from students where deleted_at is null and status='enrolled' and primary_supervisor_id is null and secondary_supervisor_id is null and third_supervisor_id is null`,
  "students.missing_academic": `select count(*)::int c from students where deleted_at is null and status='enrolled' and (nullif(btrim(coalesce(degree,'')),'') is null or nullif(btrim(coalesce(field_of_study,'')),'') is null)`,
  "professors.missing_directory": `select count(*)::int c from professors where deleted_at is null and (nullif(btrim(coalesce(faculty,'')),'') is null or nullif(btrim(coalesce(specialization,'')),'') is null)`,
  "council.missing_text": `select count(*)::int c from council_decisions where deleted_at is null and nullif(btrim(coalesce(decision_text,'')),'') is null`,
  "council.pending": `select count(*)::int c from council_decisions where deleted_at is null and workflow_state not in ('finalized','rejected')`,
  "tasks.overdue": `select count(*)::int c from tasks where deleted_at is null and status not in ('completed','cancelled') and due_at < now()`,
  "documents.quarantine": `select count(*)::int c from attachments where deleted_at is null and status in ('quarantine','scanning')`,
});
