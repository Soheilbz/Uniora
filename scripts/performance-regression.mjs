/**
 * Disposable PostgreSQL query-plan regression gate.
 *
 * This script deliberately refuses ordinary database names. It loads enough
 * rows to make sequential scans visible, ANALYZEs the tables, and then proves
 * the hot register/audit queries still use an RLS-safe indexed access path.
 * PostgreSQL deliberately does not push a non-leakproof user predicate such as
 * LIKE below a row-security policy. Fixture writes therefore use the owner
 * connection, while every asserted plan uses the request-serving Web role so
 * the gate observes the same RLS-aware access path as production.
 */
import pg from "pg";

const { Client } = pg;
const url =
  process.env.PERF_DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_ADMIN_URL?.trim() || "";
if (process.env.PERF_CONFIRM !== "I_UNDERSTAND_TEST_DATABASE")
  fail("PERF_CONFIRM must equal I_UNDERSTAND_TEST_DATABASE");
if (!url) fail("PERF_DATABASE_ADMIN_URL or DATABASE_ADMIN_URL is required");
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail("performance database URL is invalid");
}
if (!/(?:test|e2e|perf|scale)/i.test(parsed.pathname))
  fail("performance database name must contain test, e2e, perf or scale");

const applicationUrl =
  process.env.PERF_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || url;
const adminDb = new Client({
  connectionString: url,
  application_name: "univ-performance-fixture-admin",
});
const db = new Client({
  connectionString: applicationUrl,
  application_name: "univ-performance-regression",
});
let adminTransactionOpen = false;
let planTransactionOpen = false;
let tenantId;
await adminDb.connect();
await db.connect();
try {
  const tenant = (
    await adminDb.query("select id from tenants where status='active' order by created_at limit 1")
  ).rows[0];
  if (!tenant?.id)
    throw new Error("seeded active tenant is required before performance regression");
  tenantId = tenant.id;

  // These tables are protected by the same RLS contract as the application.
  // Load fixtures with the owner, then assert plans through the Web role below
  // so this gate never validates a privileged query path by accident.
  await adminDb.query("begin");
  adminTransactionOpen = true;
  await adminDb.query("select set_config('app.tenant_id',$1,true)", [tenantId]);

  await adminDb.query(
    "delete from audit_log where tenant_id=$1 and entity_type='performance_fixture'",
    [tenantId],
  );
  await adminDb.query("delete from students where tenant_id=$1 and student_number like 'perf-%'", [
    tenantId,
  ]);

  await adminDb.query(
    `
    insert into students(tenant_id, student_number, first_name, last_name, degree, status, faculty, department, field_of_study, version)
    select $1,
           'perf-' || lpad(g::text, 6, '0'),
           'دانشجو', 'کارایی ' || g,
           case when g % 2 = 0 then 'master' else 'phd' end,
           case when g % 5 = 0 then 'graduated' else 'enrolled' end,
           'دانشکده کارایی', 'گروه ' || (g % 8), 'رشته ' || (g % 12), 1
      from generate_series(1, 30000) g`,
    [tenantId],
  );

  await adminDb.query(
    `
    insert into audit_log(tenant_id, actor_id, action, entity_type, entity_id, changes, outcome, source, created_at)
    select $1, null, 'performance.event', 'performance_fixture',
           'perf-audit-' || lpad(g::text, 6, '0'),
           '{"marker":"perf-audit-' || lpad(g::text, 6, '0') || '"}',
           'success', 'performance-fixture', now() - (g || ' seconds')::interval
      from generate_series(1, 30000) g`,
    [tenantId],
  );

  await adminDb.query("analyze students");
  await adminDb.query("analyze audit_log");
  await adminDb.query("commit");
  adminTransactionOpen = false;

  await db.query("begin");
  planTransactionOpen = true;
  await db.query("select set_config('app.tenant_id',$1,true)", [tenantId]);

  await assertPlan({
    name: "student number lookup",
    sql: `select id from students where tenant_id=app.current_tenant() and deleted_at is null and student_number='perf-029999'`,
    values: [],
    index: "students_tenant_number_idx",
    maxMs: 250,
  });
  await assertPlan({
    name: "student infix search",
    sql: `select id from students where tenant_id=app.current_tenant() and deleted_at is null and search_text like '%' || app.fold_text('perf-029999') || '%' limit 50`,
    values: [],
    tenantIndexed: true,
    maxMs: 750,
  });
  await assertPlan({
    name: "audit cursor page",
    sql: `select id,created_at from audit_log where tenant_id=app.current_tenant() order by created_at desc,id desc limit 100`,
    values: [],
    index: "audit_tenant_time_id_idx",
    maxMs: 250,
  });
  await assertPlan({
    name: "audit infix search",
    sql: `select id from audit_log where tenant_id=app.current_tenant() and search_text like '%' || app.fold_text('perf-audit-029999') || '%' limit 50`,
    values: [],
    tenantIndexed: true,
    maxMs: 750,
  });

  await db.query("commit");
  planTransactionOpen = false;
  console.log("performance regression ok");
} finally {
  if (planTransactionOpen) await db.query("rollback");
  if (adminTransactionOpen) await adminDb.query("rollback");
  if (tenantId) {
    await adminDb.query("begin");
    await adminDb.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    await adminDb.query(
      "delete from audit_log where tenant_id=$1 and entity_type='performance_fixture'",
      [tenantId],
    );
    await adminDb.query(
      "delete from students where tenant_id=$1 and student_number like 'perf-%'",
      [tenantId],
    );
    await adminDb.query("commit");
  }
  await db.end();
  await adminDb.end();
}

async function assertPlan({ name, sql, values, index, tenantIndexed = false, maxMs }) {
  const result = await db.query(`explain (analyze, buffers, format json) ${sql}`, values);
  const document = result.rows[0]?.["QUERY PLAN"]?.[0];
  if (!document) throw new Error(`${name}: EXPLAIN returned no JSON plan`);
  const planNodes = collectPlanNodes(document.Plan);
  const planText = JSON.stringify(planNodes);
  if (planNodes.some((node) => node["Node Type"] === "Seq Scan")) {
    throw new Error(
      `${name}: sequential scan was used under the tenant RLS policy (${planNodes.map((node) => node["Node Type"]).join(" -> ")})`,
    );
  }
  if (index && !planText.includes(index))
    throw new Error(`${name}: expected index ${index} was not used`);
  if (
    tenantIndexed &&
    !planNodes.some(
      (node) =>
        ["Index Scan", "Index Only Scan", "Bitmap Index Scan"].includes(node["Node Type"]) &&
        String(node["Index Cond"] ?? "").includes("tenant_id = app.current_tenant()"),
    )
  ) {
    throw new Error(`${name}: no tenant-scoped indexed access path was used`);
  }
  const execution = Number(document["Execution Time"] ?? Number.NaN);
  if (!Number.isFinite(execution) || execution > maxMs) {
    throw new Error(`${name}: execution ${execution}ms exceeds ${maxMs}ms`);
  }
  const accessPath =
    index ?? planText.match(/"Index Name":"([^"]+)"/)?.[1] ?? "indexed access path";
  console.log(`${name}: ${execution.toFixed(2)}ms via ${accessPath}`);
}

function collectPlanNodes(node, nodes = []) {
  if (!node || typeof node !== "object") return nodes;
  if (typeof node["Node Type"] === "string") nodes.push(node);
  for (const child of node.Plans ?? []) collectPlanNodes(child, nodes);
  return nodes;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
