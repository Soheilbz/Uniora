import {
  PLATFORM_EXECUTE_FUNCTIONS,
  PLATFORM_MUTABLE_TABLES,
  PLATFORM_ROLE,
} from "./platform-role-policy.mjs";
import {
  WEB_APPEND_ONLY_TABLES,
  WEB_EXECUTE_FUNCTIONS,
  WEB_MUTABLE_TABLES,
  WEB_READ_ONLY_TABLES,
  WEB_RLS_EXEMPT_TABLES,
} from "./web-role-policy.mjs";
import {
  WORKER_EXECUTE_FUNCTIONS,
  WORKER_ROLE,
  WORKER_TABLE_PRIVILEGES,
} from "./worker-role-policy.mjs";

export async function assertRestoreTargetRolesExist(pool) {
  const result = await pool.query(`
    select r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreatedb,
      r.rolcreaterole, r.rolreplication, r.rolinherit,
      exists (select 1 from pg_auth_members m where m.member=r.oid) as has_membership
      from pg_roles r
     where r.rolname in ('univ_app_web', '${WORKER_ROLE}', '${PLATFORM_ROLE}')
  `);
  const byName = new Map(result.rows.map((row) => [row.rolname, row]));
  const webRole = byName.get("univ_app_web");
  const workerRole = byName.get(WORKER_ROLE);
  const platformRole = byName.get(PLATFORM_ROLE);
  if (!webRole) {
    throw new Error(
      "restore target is missing the univ_app_web role; provision runtime roles before restore",
    );
  }
  if (!workerRole) {
    throw new Error(
      `restore target is missing the ${WORKER_ROLE} role; provision runtime roles before restore`,
    );
  }
  if (!platformRole) {
    throw new Error(
      `restore target is missing the ${PLATFORM_ROLE} role; provision runtime roles before restore`,
    );
  }
  assertRuntimeRoleContract(webRole, false, "application");
  assertRuntimeRoleContract(workerRole, true, "tenant worker");
  assertRuntimeRoleContract(platformRole, true, "Platform worker");
}

function assertRuntimeRoleContract(role, bypassRls, label) {
  if (
    !role.rolcanlogin ||
    role.rolsuper ||
    role.rolbypassrls !== bypassRls ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolinherit ||
    role.has_membership
  ) {
    throw new Error(`restore target ${label} role violates the production role contract`);
  }
}

export async function assertRestoredWebPrivilegeContract(pool) {
  const tables = (
    await pool.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        has_table_privilege('univ_app_web', format('%I.%I', n.nspname, c.relname), 'SELECT') as can_select,
        has_table_privilege('univ_app_web', format('%I.%I', n.nspname, c.relname), 'INSERT') as can_insert,
        has_table_privilege('univ_app_web', format('%I.%I', n.nspname, c.relname), 'UPDATE') as can_update,
        has_table_privilege('univ_app_web', format('%I.%I', n.nspname, c.relname), 'DELETE') as can_delete
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')
      order by c.relname
    `)
  ).rows;
  if (tables.length === 0) throw new Error("restored database has no public tables");

  const mutableNames = new Set(WEB_MUTABLE_TABLES);
  const appendOnlyNames = new Set(WEB_APPEND_ONLY_TABLES);
  const readOnlyNames = new Set(WEB_READ_ONLY_TABLES);
  for (const table of tables) {
    if (table.relname === "tenants") {
      if (!table.can_select || table.can_insert || table.can_update || table.can_delete)
        throw new Error("restored tenants privileges are not read-only for the Web role");
      continue;
    }
    if (table.relname === "platform_audit_log") {
      if (table.can_select || table.can_insert || table.can_update || table.can_delete)
        throw new Error(`restored ${table.relname} is exposed to the Web role`);
      continue;
    }
    if (mutableNames.has(table.relname)) {
      if (!table.can_select || !table.can_insert || !table.can_update || !table.can_delete)
        throw new Error(`restored Web role is missing CRUD on ${table.relname}`);
      continue;
    }
    if (appendOnlyNames.has(table.relname)) {
      if (!table.can_select || !table.can_insert || table.can_update || table.can_delete)
        throw new Error(
          `restored Web role must have SELECT/INSERT-only access to ${table.relname}`,
        );
      continue;
    }
    if (readOnlyNames.has(table.relname)) {
      if (!table.can_select || table.can_insert || table.can_update || table.can_delete)
        throw new Error(`restored Web role must have read-only access to ${table.relname}`);
      continue;
    }
    throw new Error(
      `restored table is not classified in the canonical Web privilege policy: ${table.relname}`,
    );
  }

  const rlsExempt = new Set(WEB_RLS_EXEMPT_TABLES);
  for (const table of tables) {
    if (rlsExempt.has(table.relname)) continue;
    if (!table.relrowsecurity || !table.relforcerowsecurity) {
      throw new Error(`restored tenant table lacks forced RLS: ${table.relname}`);
    }
  }

  const sequenceSafety = (
    await pool.query(`
      select count(*)::int as missing
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='S'
        and (not has_sequence_privilege('univ_app_web', c.oid, 'USAGE')
          or not has_sequence_privilege('univ_app_web', c.oid, 'SELECT'))
    `)
  ).rows[0];
  if (Number(sequenceSafety?.missing ?? 0) !== 0) {
    throw new Error("restored Web role is missing required public sequence privileges");
  }

  const safety = (
    await pool.query(`
      select
        has_schema_privilege('univ_app_web', 'public', 'CREATE') as public_create,
        has_schema_privilege('univ_app_web', 'app', 'CREATE') as app_create,
        has_database_privilege('univ_app_web', current_database(), 'TEMPORARY') as db_temp,
        has_function_privilege('univ_app_web', 'app.current_tenant()', 'EXECUTE') as tenant_context_execute,
        (select relrowsecurity and relforcerowsecurity
           from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname='students') as students_forced_rls
    `)
  ).rows[0];
  if (safety?.public_create || safety?.app_create || safety?.db_temp) {
    throw new Error("restored Web role regained a forbidden schema/database privilege");
  }
  if (!safety?.tenant_context_execute || !safety?.students_forced_rls) {
    throw new Error("restored tenant isolation execution/RLS contract is incomplete");
  }

  const functions = (
    await pool.query(`
      select format('app.%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as signature,
        has_function_privilege('univ_app_web', p.oid, 'EXECUTE') as can_execute
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app'
      order by 1
    `)
  ).rows;
  const expectedFunctions = new Set(WEB_EXECUTE_FUNCTIONS.map(canonicalSignature));
  const bySignature = new Map(functions.map((row) => [canonicalSignature(row.signature), row]));
  for (const signature of expectedFunctions) {
    if (!bySignature.get(signature)?.can_execute) {
      throw new Error(`restored Web role cannot execute required function ${signature}`);
    }
  }
  for (const row of functions) {
    if (row.can_execute && !expectedFunctions.has(canonicalSignature(row.signature))) {
      throw new Error(`restored Web role can execute unexpected app function ${row.signature}`);
    }
  }
}

function canonicalSignature(signature) {
  return String(signature)
    .replace(/,\s+/g, ",")
    .replaceAll("timestamp with time zone", "timestamptz");
}

export async function assertRestoredWorkerPrivilegeContract(pool) {
  const tables = (
    await pool.query(`
      select c.relname,
        has_table_privilege('${WORKER_ROLE}', c.oid, 'SELECT') as can_select,
        has_table_privilege('${WORKER_ROLE}', c.oid, 'INSERT') as can_insert,
        has_table_privilege('${WORKER_ROLE}', c.oid, 'UPDATE') as can_update,
        has_table_privilege('${WORKER_ROLE}', c.oid, 'DELETE') as can_delete
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p')
      order by c.relname
    `)
  ).rows;
  const expectedByTable = new Map(
    Object.entries(WORKER_TABLE_PRIVILEGES).map(([table, privileges]) => [
      table,
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
    if (actual.size !== expected.size || [...actual].some((item) => !expected.has(item))) {
      throw new Error(`restored tenant worker has unexpected privileges on ${table.relname}`);
    }
  }
  for (const table of expectedByTable.keys()) {
    if (!tables.some((candidate) => candidate.relname === table)) {
      throw new Error(`restored tenant worker expected table is missing: ${table}`);
    }
  }

  const infrastructure = (
    await pool.query(`
      select
        has_schema_privilege('${WORKER_ROLE}', 'public', 'USAGE') as public_usage,
        has_schema_privilege('${WORKER_ROLE}', 'public', 'CREATE') as public_create,
        has_schema_privilege('${WORKER_ROLE}', 'app', 'USAGE') as app_usage,
        has_schema_privilege('${WORKER_ROLE}', 'app', 'CREATE') as app_create,
        has_database_privilege('${WORKER_ROLE}', current_database(), 'TEMPORARY') as db_temp,
        exists (
          select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind='S'
            and (has_sequence_privilege('${WORKER_ROLE}', c.oid, 'USAGE')
              or has_sequence_privilege('${WORKER_ROLE}', c.oid, 'SELECT')
              or has_sequence_privilege('${WORKER_ROLE}', c.oid, 'UPDATE'))
        ) as sequence_access
    `)
  ).rows[0];
  if (
    !infrastructure?.public_usage ||
    !infrastructure?.app_usage ||
    infrastructure.public_create ||
    infrastructure.app_create ||
    infrastructure.db_temp ||
    infrastructure.sequence_access
  ) {
    throw new Error("restored tenant worker infrastructure privileges violate least privilege");
  }
  await assertFunctionAllowList(pool, WORKER_ROLE, WORKER_EXECUTE_FUNCTIONS, "tenant worker");
}

export async function assertRestoredPlatformPrivilegeContract(pool) {
  const tables = (
    await pool.query(`
      select n.nspname as schema_name, c.relname,
        has_table_privilege('${PLATFORM_ROLE}', c.oid, 'SELECT') as can_select,
        has_table_privilege('${PLATFORM_ROLE}', c.oid, 'INSERT') as can_insert,
        has_table_privilege('${PLATFORM_ROLE}', c.oid, 'UPDATE') as can_update,
        has_table_privilege('${PLATFORM_ROLE}', c.oid, 'DELETE') as can_delete
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','app','drizzle') and c.relkind in ('r','p','v','m')
      order by n.nspname,c.relname
    `)
  ).rows;
  const mutable = new Set(PLATFORM_MUTABLE_TABLES);
  for (const table of tables) {
    if (!table.can_select) {
      throw new Error(`restored Platform worker cannot read ${table.schema_name}.${table.relname}`);
    }
    const shouldMutate = table.schema_name === "public" && mutable.has(table.relname);
    if (
      table.can_insert !== shouldMutate ||
      table.can_update !== shouldMutate ||
      table.can_delete !== shouldMutate
    ) {
      throw new Error(
        `restored Platform worker has unexpected DML on ${table.schema_name}.${table.relname}`,
      );
    }
  }
  for (const table of mutable) {
    if (
      !tables.some((candidate) => candidate.schema_name === "public" && candidate.relname === table)
    ) {
      throw new Error(`restored Platform worker expected mutable table is missing: ${table}`);
    }
  }

  const infrastructure = (
    await pool.query(`
      select
        has_schema_privilege('${PLATFORM_ROLE}', 'public', 'USAGE') as public_usage,
        has_schema_privilege('${PLATFORM_ROLE}', 'app', 'USAGE') as app_usage,
        has_schema_privilege('${PLATFORM_ROLE}', 'drizzle', 'USAGE') as drizzle_usage,
        has_schema_privilege('${PLATFORM_ROLE}', 'public', 'CREATE') as public_create,
        has_schema_privilege('${PLATFORM_ROLE}', 'app', 'CREATE') as app_create,
        has_schema_privilege('${PLATFORM_ROLE}', 'drizzle', 'CREATE') as drizzle_create,
        has_database_privilege('${PLATFORM_ROLE}', current_database(), 'TEMPORARY') as db_temp,
        exists (
          select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname in ('public','app','drizzle') and c.relkind='S'
            and (not has_sequence_privilege('${PLATFORM_ROLE}', c.oid, 'USAGE')
              or not has_sequence_privilege('${PLATFORM_ROLE}', c.oid, 'SELECT')
              or has_sequence_privilege('${PLATFORM_ROLE}', c.oid, 'UPDATE'))
        ) as bad_sequence
    `)
  ).rows[0];
  if (
    !infrastructure?.public_usage ||
    !infrastructure?.app_usage ||
    !infrastructure?.drizzle_usage ||
    infrastructure.public_create ||
    infrastructure.app_create ||
    infrastructure.drizzle_create ||
    infrastructure.db_temp ||
    infrastructure.bad_sequence
  ) {
    throw new Error("restored Platform worker infrastructure privileges violate least privilege");
  }
  await assertFunctionAllowList(pool, PLATFORM_ROLE, PLATFORM_EXECUTE_FUNCTIONS, "Platform worker");
}

async function assertFunctionAllowList(pool, role, expectedFunctions, label) {
  const expected = new Set(expectedFunctions.map(canonicalSignature));
  const rows = (
    await pool.query(`
      select format('app.%s(%s)', p.proname, oidvectortypes(p.proargtypes)) as signature,
        has_function_privilege('${role}', p.oid, 'EXECUTE') as can_execute
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='app'
      order by 1
    `)
  ).rows;
  for (const row of rows) {
    if (row.can_execute && !expected.has(canonicalSignature(row.signature))) {
      throw new Error(`restored ${label} can execute unexpected app function ${row.signature}`);
    }
  }
  for (const signature of expected) {
    if (!rows.some((row) => canonicalSignature(row.signature) === signature && row.can_execute)) {
      throw new Error(`restored ${label} cannot execute required function ${signature}`);
    }
  }
}
