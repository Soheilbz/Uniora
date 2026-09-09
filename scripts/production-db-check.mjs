/** Verify the restricted database role used by the production Web process.
 * Privileged owner/backup credentials belong to isolated operator jobs and are
 * intentionally outside this check and outside the Web environment. */
import pg from "pg";
import {
  PLATFORM_EXECUTE_FUNCTIONS,
  PLATFORM_MUTABLE_TABLES,
  PLATFORM_ROLE,
} from "./lib/platform-role-policy.mjs";
import {
  WEB_APPEND_ONLY_TABLES,
  WEB_EXECUTE_FUNCTIONS,
  WEB_MUTABLE_TABLES,
  WEB_READ_ONLY_TABLES,
  WEB_RLS_EXEMPT_TABLES,
} from "./lib/web-role-policy.mjs";
import { WORKER_EXECUTE_FUNCTIONS, WORKER_TABLE_PRIVILEGES } from "./lib/worker-role-policy.mjs";

const { Pool } = pg;
const failures = [];

await checkRole("DATABASE_URL", { kind: "web", bypassRls: false, role: "univ_app_web" });
await checkRole("DATABASE_WORKER_URL", {
  kind: "worker",
  bypassRls: true,
  role: "univ_job_worker",
});
await checkRole("DATABASE_PLATFORM_URL", {
  kind: "platform",
  bypassRls: true,
  role: PLATFORM_ROLE,
});

if (failures.length > 0) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("production database privileges ok");

async function checkRole(environmentKey, expected) {
  const connectionString = process.env[environmentKey]?.trim();
  if (!connectionString) {
    failures.push(`${environmentKey} is required`);
    return;
  }

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    const role = (
      await pool.query(`
        select current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
          rolcanlogin, rolreplication, rolinherit,
          has_schema_privilege(current_user, 'public', 'CREATE') as public_create,
          has_schema_privilege(current_user, 'app', 'CREATE') as app_create,
          has_schema_privilege(current_user, 'drizzle', 'CREATE') as drizzle_create,
          has_database_privilege(current_user, current_database(), 'TEMPORARY') as db_temp
        from pg_roles
        where rolname = current_user
      `)
    ).rows[0];

    if (!role) {
      failures.push(`${environmentKey} could not resolve the connected role`);
      return;
    }
    if (role.current_user !== expected.role) {
      failures.push(
        `${environmentKey} connected as ${role.current_user}; expected ${expected.role}`,
      );
    }
    for (const key of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "public_create",
      "app_create",
      "drizzle_create",
      "db_temp",
    ]) {
      if (role[key]) failures.push(`${environmentKey} role has forbidden privilege: ${key}`);
    }
    if (!role.rolcanlogin) failures.push(`${environmentKey} role must be able to login`);
    if (role.rolreplication)
      failures.push(`${environmentKey} role must not have replication privilege`);
    if (role.rolinherit) failures.push(`${environmentKey} role must not inherit privileges`);
    if (role.rolbypassrls !== expected.bypassRls) {
      failures.push(`${environmentKey} role has unexpected BYPASSRLS setting`);
    }

    const memberships = (
      await pool.query(`
        select 1
        from pg_auth_members m
        join pg_roles member on member.oid = m.member
        where member.rolname = current_user
        limit 1
      `)
    ).rows;
    if (memberships.length > 0) {
      failures.push(`${environmentKey} role must not be a member of another role`);
    }

    const inspectedSchemas =
      expected.kind === "platform" ? ["public", "app", "drizzle"] : ["public"];
    const tables = (
      await pool.query(
        `select n.nspname as schema_name, c.relname, c.relrowsecurity, c.relforcerowsecurity,
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'SELECT') as can_select,
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'INSERT') as can_insert,
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'UPDATE') as can_update,
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'DELETE') as can_delete
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1::text[]) and c.relkind in ('r', 'p', 'v', 'm')
          and not exists (
            select 1
            from pg_depend d
            join pg_extension e on e.oid = d.refobjid
            where d.classid = 'pg_class'::regclass
              and d.objid = c.oid
              and d.deptype = 'e'
          )
        order by n.nspname, c.relname`,
        [inspectedSchemas],
      )
    ).rows;

    if (expected.kind === "platform") {
      checkPlatformTables(environmentKey, tables);
      const infrastructure = (
        await pool.query(`
          select
            has_schema_privilege(current_user, 'public', 'USAGE') as public_usage,
            has_schema_privilege(current_user, 'app', 'USAGE') as app_usage,
            has_schema_privilege(current_user, 'drizzle', 'USAGE') as drizzle_usage,
            exists (
              select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname in ('public','app','drizzle') and c.relkind='S'
                and (not has_sequence_privilege(current_user, c.oid, 'USAGE')
                  or not has_sequence_privilege(current_user, c.oid, 'SELECT')
                  or has_sequence_privilege(current_user, c.oid, 'UPDATE'))
            ) as bad_sequence
        `)
      ).rows[0];
      if (
        !infrastructure?.public_usage ||
        !infrastructure?.app_usage ||
        !infrastructure?.drizzle_usage
      ) {
        failures.push(
          `${environmentKey} role needs USAGE on public/app/drizzle for reviewed backup/read operations`,
        );
      }
      if (infrastructure?.bad_sequence) {
        failures.push(`${environmentKey} sequence privileges must be USAGE/SELECT only`);
      }
      await checkFunctionAllowList(environmentKey, pool, PLATFORM_EXECUTE_FUNCTIONS);
      return;
    }

    if (expected.kind === "worker") {
      checkWorkerTables(environmentKey, tables);
      const workerInfrastructure = (
        await pool.query(`
          select
            has_schema_privilege(current_user, 'public', 'USAGE') as public_usage,
            has_schema_privilege(current_user, 'app', 'USAGE') as app_usage,
            exists (
              select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind='S'
                and (has_sequence_privilege(current_user, c.oid, 'USAGE')
                  or has_sequence_privilege(current_user, c.oid, 'SELECT')
                  or has_sequence_privilege(current_user, c.oid, 'UPDATE'))
            ) as any_sequence_privilege
        `)
      ).rows[0];
      if (!workerInfrastructure?.public_usage) {
        failures.push(`${environmentKey} role needs USAGE on public schema`);
      }
      if (!workerInfrastructure?.app_usage) {
        failures.push(`${environmentKey} role needs USAGE on app schema for its health function`);
      }
      if (workerInfrastructure?.any_sequence_privilege) {
        failures.push(`${environmentKey} role must have no public sequence privileges`);
      }
      await checkFunctionAllowList(environmentKey, pool, WORKER_EXECUTE_FUNCTIONS);
      return;
    }

    const mutableNames = new Set(WEB_MUTABLE_TABLES);
    const appendOnlyNames = new Set(WEB_APPEND_ONLY_TABLES);
    const readOnlyNames = new Set(WEB_READ_ONLY_TABLES);

    for (const table of tables) {
      if (table.relname === "tenants") {
        if (!table.can_select || table.can_insert || table.can_update || table.can_delete)
          failures.push(`${environmentKey} role must have read-only access to tenants`);
        continue;
      }
      if (table.relname === "platform_audit_log") {
        if (table.can_select || table.can_insert || table.can_update || table.can_delete)
          failures.push(`${environmentKey} role must have no access to ${table.relname}`);
        continue;
      }
      if (mutableNames.has(table.relname)) {
        if (!table.can_select || !table.can_insert || !table.can_update || !table.can_delete)
          failures.push(`${environmentKey} role is missing CRUD on ${table.relname}`);
        continue;
      }
      if (appendOnlyNames.has(table.relname)) {
        if (!table.can_select || !table.can_insert || table.can_update || table.can_delete)
          failures.push(
            `${environmentKey} role must have SELECT/INSERT-only access to ${table.relname}`,
          );
        continue;
      }
      if (readOnlyNames.has(table.relname)) {
        if (!table.can_select || table.can_insert || table.can_update || table.can_delete)
          failures.push(`${environmentKey} role must have read-only access to ${table.relname}`);
        continue;
      }
      failures.push(
        `${environmentKey} table is not classified in the canonical Web privilege policy: ${table.relname}`,
      );
    }

    const noRlsByDesign = new Set(WEB_RLS_EXEMPT_TABLES);
    const isolated = tables.filter((table) => !noRlsByDesign.has(table.relname));
    if (!expected.bypassRls && isolated.some((table) => !table.relrowsecurity)) {
      failures.push(`${environmentKey} role is missing RLS on a tenant/indirect table`);
    }
    if (!expected.bypassRls && isolated.some((table) => !table.relforcerowsecurity)) {
      failures.push(`${environmentKey} role is missing FORCE RLS on a tenant/indirect table`);
    }

    const infrastructure = (
      await pool.query(`
        select
          has_function_privilege(current_user, 'app.current_tenant()', 'EXECUTE') as tenant_context_execute,
          not exists (
            select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='S'
              and (not has_sequence_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'USAGE')
                or not has_sequence_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'SELECT'))
          ) as sequences_ok
      `)
    ).rows[0];
    if (!infrastructure?.tenant_context_execute) {
      failures.push(`${environmentKey} role cannot execute app.current_tenant()`);
    }
    if (!infrastructure?.sequences_ok) {
      failures.push(`${environmentKey} role is missing USAGE/SELECT on a public sequence`);
    }

    const appFunctions = (
      await pool.query(`
        select format('app.%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as signature,
          has_function_privilege(current_user, p.oid, 'EXECUTE') as can_execute
        from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='app'
        order by 1
      `)
    ).rows;
    const expectedFunctions = new Set(WEB_EXECUTE_FUNCTIONS.map(canonicalSignature));
    const bySignature = new Map(
      appFunctions.map((row) => [canonicalSignature(row.signature), row]),
    );
    for (const signature of expectedFunctions) {
      if (!bySignature.get(signature)?.can_execute) {
        failures.push(`${environmentKey} role cannot execute required function ${signature}`);
      }
    }
    for (const row of appFunctions) {
      if (row.can_execute && !expectedFunctions.has(canonicalSignature(row.signature))) {
        failures.push(
          `${environmentKey} role can execute unexpected app function ${row.signature}`,
        );
      }
    }
  } catch {
    failures.push(`${environmentKey} connection or privilege inspection failed`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkFunctionAllowList(environmentKey, pool, expectedFunctions) {
  const expected = new Set(expectedFunctions.map(canonicalSignature));
  const rows = (
    await pool.query(`
      select format('app.%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as signature,
        has_function_privilege(current_user, p.oid, 'EXECUTE') as can_execute
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app'
      order by 1
    `)
  ).rows;
  for (const row of rows) {
    if (row.can_execute && !expected.has(canonicalSignature(row.signature))) {
      failures.push(`${environmentKey} role can execute unexpected app function ${row.signature}`);
    }
  }
  for (const signature of expected) {
    if (!rows.some((row) => canonicalSignature(row.signature) === signature && row.can_execute)) {
      failures.push(`${environmentKey} role cannot execute required function ${signature}`);
    }
  }
}

function canonicalSignature(signature) {
  return String(signature)
    .replace(/,\s+/g, ",")
    .replaceAll("timestamp with time zone", "timestamptz");
}

function checkPlatformTables(environmentKey, tables) {
  const mutable = new Set(PLATFORM_MUTABLE_TABLES);
  for (const table of tables) {
    if (!table.can_select) {
      failures.push(
        `${environmentKey} role is missing SELECT on ${table.schema_name}.${table.relname}`,
      );
    }
    const shouldMutate = table.schema_name === "public" && mutable.has(table.relname);
    if (
      table.can_insert !== shouldMutate ||
      table.can_update !== shouldMutate ||
      table.can_delete !== shouldMutate
    ) {
      failures.push(
        `${environmentKey} role has unexpected DML on ${table.schema_name}.${table.relname}`,
      );
    }
  }
  for (const table of mutable) {
    if (
      !tables.some((candidate) => candidate.schema_name === "public" && candidate.relname === table)
    ) {
      failures.push(`${environmentKey} expected Platform mutable table is missing: ${table}`);
    }
  }
}

function checkWorkerTables(environmentKey, tables) {
  const expectedByTable = new Map(
    Object.entries(WORKER_TABLE_PRIVILEGES).map(([name, privileges]) => [
      name,
      new Set(privileges),
    ]),
  );
  for (const table of tables) {
    const expected = expectedByTable.get(table.relname) ?? new Set();
    const actual = new Set([
      ...(table.can_select ? ["SELECT"] : []),
      ...(table.can_insert ? ["INSERT"] : []),
      ...(table.can_update ? ["UPDATE"] : []),
      ...(table.can_delete ? ["DELETE"] : []),
    ]);
    const same =
      actual.size === expected.size && [...actual].every((privilege) => expected.has(privilege));
    if (!same) {
      failures.push(
        `${environmentKey} table ${table.relname} privileges are ${[...actual].join("/") || "none"}; ` +
          `expected ${[...expected].join("/") || "none"}`,
      );
    }
  }
  for (const table of expectedByTable.keys()) {
    if (!tables.some((candidate) => candidate.relname === table)) {
      failures.push(`${environmentKey} expected worker table is missing: ${table}`);
    }
  }
}
