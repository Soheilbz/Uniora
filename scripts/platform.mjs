/** Platform-only tenant operations. Privileged credentials never enter Next.js. */
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_PLATFORM_URL?.trim();
const operator = process.env.PLATFORM_OPERATOR?.trim();
const requestId = process.env.PLATFORM_REQUEST_ID?.trim() || null;
if (!url) fail("DATABASE_PLATFORM_URL is required");
if (!operator) fail("PLATFORM_OPERATOR is required");
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
const [command, ...args] = process.argv.slice(2);
try {
  if (command === "tenant:list") await listTenants();
  else if (command === "platform:health") await platformHealth();
  else if (["tenant:suspend", "tenant:resume", "tenant:archive"].includes(command)) {
    const slug = option(args, "--slug");
    if (!slug) fail("--slug is required");
    if (command === "tenant:archive" && option(args, "--confirm") !== `ARCHIVE:${slug}`) {
      fail(`archive requires --confirm ARCHIVE:${slug}`);
    }
    await changeTenant(command.split(":")[1], slug);
  } else if (command === "tenant:owner:set") {
    const slug = option(args, "--slug");
    const username = option(args, "--username")?.toLowerCase();
    const reason = option(args, "--reason")?.trim();
    if (!slug || !username || !reason) fail("--slug, --username and --reason are required");
    if (reason.length < 10 || reason.length > 500)
      fail("owner change reason must contain 10 to 500 characters");
    if (option(args, "--confirm") !== `SET-OWNER:${slug}:${username}`) {
      fail(`owner recovery requires --confirm SET-OWNER:${slug}:${username}`);
    }
    await setTenantOwner(slug, username, reason);
  } else if (command === "tenant:mfa:reset-owner") {
    const slug = option(args, "--slug");
    const username = option(args, "--username")?.toLowerCase();
    const confirm = option(args, "--confirm");
    if (!slug || !username) fail("--slug and --username are required");
    if (confirm !== `RESET-MFA:${slug}:${username}`) {
      fail(`owner MFA reset requires --confirm RESET-MFA:${slug}:${username}`);
    }
    await resetTenantOwnerMfa(slug, username);
  } else if (command === "tenant:failed:purge") {
    const slug = option(args, "--slug");
    const confirm = option(args, "--confirm");
    if (!slug) fail("--slug is required");
    if (confirm !== `PURGE:${slug}`) fail(`purge requires --confirm PURGE:${slug}`);
    await purgeFailedTenant(slug);
  } else {
    fail(
      "usage: platform.mjs platform:health | tenant:list | tenant:suspend|tenant:resume --slug <slug> | tenant:archive --slug <slug> --confirm ARCHIVE:<slug> | tenant:owner:set --slug <slug> --username <local-username> --reason <reason> --confirm SET-OWNER:<slug>:<local-username> | tenant:mfa:reset-owner --slug <slug> --username <local-username> --confirm RESET-MFA:<slug>:<local-username> | tenant:failed:purge --slug <slug> --confirm PURGE:<slug>",
    );
  }
} finally {
  await pool.end();
}

async function listTenants() {
  const { rows } = await pool.query(`
    select t.slug,t.name,t.status,t.provisioning_status,
           count(distinct u.id)::int as users,
           count(distinct s.id) filter (where s.expires_at > now())::int as live_sessions,
           max(u.last_login_at) as last_activity,
           max(owner.display_username) as owner
      from tenants t
      left join "user" u on u.tenant_id=t.id
      left join session s on s.user_id=u.id
      left join tenant_owners o on o.tenant_id=t.id
      left join "user" owner on owner.id=o.user_id and owner.tenant_id=t.id
     group by t.id,t.slug,t.name,t.status,t.provisioning_status
     order by t.slug`);
  console.table(rows);
}

async function platformHealth() {
  const {
    rows: [row],
  } = await pool.query(`
    select current_database() as database,
           current_setting('server_version') as postgres_version,
           count(*)::int as tenants,
           count(*) filter (where status='active' and provisioning_status='active')::int as active_tenants,
           count(*) filter (where provisioning_status='failed')::int as failed_provisioning,
           count(*) filter (where status='suspended')::int as suspended_tenants,
           count(*) filter (where status='archived')::int as archived_tenants
      from tenants`);
  const {
    rows: [owners],
  } = await pool.query(`
    select count(*)::int as tenants_without_owner
      from tenants t
     where t.provisioning_status='active'
       and not exists (select 1 from tenant_owners o where o.tenant_id=t.id)`);
  console.table([{ ...row, ...owners }]);
  if (Number(row?.failed_provisioning ?? 0) > 0 || Number(owners?.tenants_without_owner ?? 0) > 0)
    process.exitCode = 2;
}

async function changeTenant(action, slug) {
  const client = await pool.connect();
  let tenantId = null;
  try {
    await client.query("begin");
    const found = await client.query(
      `select id,status,provisioning_status from tenants where slug=$1 for update`,
      [slug],
    );
    if (!found.rows[0]) throw new Error(`tenant not found: ${slug}`);
    const before = found.rows[0];
    tenantId = before.id;
    if (before.provisioning_status !== "active")
      throw new Error(`tenant is not fully provisioned: ${before.provisioning_status}`);

    let status;
    if (action === "suspend") {
      if (before.status !== "active")
        throw new Error(`only an active tenant can be suspended (current: ${before.status})`);
      status = "suspended";
      await client.query(
        `update tenants set status=$1,suspended_at=now(),updated_at=now() where id=$2`,
        [status, before.id],
      );
    } else if (action === "resume") {
      if (before.status !== "suspended")
        throw new Error(`only a suspended tenant can be resumed (current: ${before.status})`);
      status = "active";
      await client.query(
        `update tenants set status=$1,suspended_at=null,updated_at=now() where id=$2`,
        [status, before.id],
      );
    } else {
      if (!["active", "suspended"].includes(before.status))
        throw new Error(`tenant cannot be archived from ${before.status}`);
      status = "archived";
      await client.query(
        `update tenants set status=$1,archived_at=now(),suspended_at=null,updated_at=now() where id=$2`,
        [status, before.id],
      );
    }
    if (status !== "active") {
      await client.query(
        `delete from session s using "user" u where s.user_id=u.id and u.tenant_id=$1`,
        [before.id],
      );
    }
    await client.query(
      `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id) values($1,$2,$3,$4,$5,'success',$6)`,
      [
        operator,
        `tenant.${action}`,
        before.id,
        slug,
        JSON.stringify({ from: before.status, to: status }),
        requestId,
      ],
    );
    await client.query("commit");
    console.log(`${slug}: ${status}`);
  } catch (e) {
    await client.query("rollback");
    await safePlatformAudit(`tenant.${action}.failed`, tenantId, slug, { error: message(e) });
    throw e;
  } finally {
    client.release();
  }
}

async function setTenantOwner(slug, username, reason) {
  const client = await pool.connect();
  let tenantId = null;
  try {
    await client.query("begin");
    const tenant = await client.query(
      `select id,status,provisioning_status from tenants where slug=$1 for update`,
      [slug],
    );
    if (!tenant.rows[0]) throw new Error(`tenant not found: ${slug}`);
    tenantId = tenant.rows[0].id;
    if (tenant.rows[0].provisioning_status !== "active")
      throw new Error(`tenant is not fully provisioned: ${tenant.rows[0].provisioning_status}`);
    if (tenant.rows[0].status === "archived")
      throw new Error("an archived tenant cannot receive a new owner");

    const target = await client.query(
      `select distinct u.id
         from "user" u
         join user_roles ur on ur.user_id=u.id and ur.tenant_id=u.tenant_id
         join roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
         left join institutions i on i.tenant_id=u.tenant_id
        where u.tenant_id=$1 and lower(u.display_username)=lower($2)
          and u.suspended_at is null
          and (u.account_expires_at is null or u.account_expires_at > now())
          and (u.employment_start is null or u.employment_start <= (now() at time zone coalesce(i.timezone,'UTC'))::date)
          and (u.employment_end is null or u.employment_end >= (now() at time zone coalesce(i.timezone,'UTC'))::date)
          and not u.must_change_password
          and r.tier >= 2
          and exists (
            select 1 from user_roles ur2
            join roles r2 on r2.id=ur2.role_id and r2.tenant_id=ur2.tenant_id
            join role_capabilities rc2 on rc2.role_id=r2.id
            where ur2.tenant_id=u.tenant_id and ur2.user_id=u.id and rc2.capability='users.manage'
          )
          and exists (
            select 1 from user_roles ur3
            join roles r3 on r3.id=ur3.role_id and r3.tenant_id=ur3.tenant_id
            join role_capabilities rc3 on rc3.role_id=r3.id
            where ur3.tenant_id=u.tenant_id and ur3.user_id=u.id and rc3.capability='roles.manage'
          )
        limit 1`,
      [tenantId, username],
    );
    if (!target.rows[0])
      throw new Error(
        "target must be an active, activated administrator with MFA and user/role management authority in this tenant",
      );
    const before = await client.query(`select user_id from tenant_owners where tenant_id=$1`, [
      tenantId,
    ]);
    await client.query(
      `insert into tenant_owners(tenant_id,user_id) values($1,$2)
       on conflict (tenant_id) do update set user_id=excluded.user_id, updated_at=now()`,
      [tenantId, target.rows[0].id],
    );
    if (before.rows[0]?.user_id && before.rows[0].user_id !== target.rows[0].id) {
      await client.query(`delete from session where user_id=$1`, [before.rows[0].user_id]);
    }
    await client.query(
      `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id) values($1,'tenant.owner.recovered',$2,$3,$4,'success',$5)`,
      [
        operator,
        tenantId,
        username,
        JSON.stringify({
          from: before.rows[0]?.user_id ?? null,
          to: target.rows[0].id,
          reason,
          previousOwnerSessions:
            before.rows[0]?.user_id && before.rows[0].user_id !== target.rows[0].id
              ? { revoked: true }
              : { revoked: false },
        }),
        requestId,
      ],
    );
    await client.query("commit");
    console.log(`${slug}: owner -> ${username}`);
  } catch (e) {
    await client.query("rollback");
    await safePlatformAudit("tenant.owner.recovery_failed", tenantId, `${slug}/${username}`, {
      error: message(e),
    });
    throw e;
  } finally {
    client.release();
  }
}

async function resetTenantOwnerMfa(slug, username) {
  const client = await pool.connect();
  let tenantId = null;
  try {
    await client.query("begin");
    const target = await client.query(
      `select t.id as tenant_id, t.status, t.provisioning_status, u.id as user_id,
              u.display_username, u.suspended_at, u.account_expires_at, u.employment_start, u.employment_end,
              coalesce(i.timezone, 'UTC') as timezone
         from tenants t
         join tenant_owners o on o.tenant_id=t.id
         join "user" u on u.id=o.user_id and u.tenant_id=t.id
         left join institutions i on i.tenant_id=t.id
        where t.slug=$1 and lower(u.display_username)=lower($2)
        for update of t,u,o`,
      [slug, username],
    );
    const row = target.rows[0];
    if (!row) throw new Error("the named account is not the current tenant owner");
    tenantId = row.tenant_id;
    if (row.provisioning_status !== "active")
      throw new Error(`tenant is not fully provisioned: ${row.provisioning_status}`);
    if (row.status === "archived")
      throw new Error("an archived tenant owner cannot be recovered for sign-in");
    if (row.suspended_at)
      throw new Error("the current owner account is suspended; recover ownership instead");
    if (row.account_expires_at && new Date(row.account_expires_at) <= new Date())
      throw new Error("the current owner account is expired; recover ownership instead");

    const employment = await client.query(
      `select
         $1::date > (now() at time zone $3)::date as not_started,
         $2::date < (now() at time zone $3)::date as ended`,
      [row.employment_start, row.employment_end, row.timezone],
    );
    if (row.employment_start && employment.rows[0]?.not_started)
      throw new Error("the current owner's employment has not started; recover ownership instead");
    if (row.employment_end && employment.rows[0]?.ended)
      throw new Error("the current owner's employment has ended; recover ownership instead");

    const before = await client.query(
      `select mfa_enabled from "user" where id=$1 and tenant_id=$2`,
      [row.user_id, tenantId],
    );
    await client.query(
      `update "user"
          set mfa_enabled=false,
              mfa_secret_encrypted=null,
              mfa_pending_secret_encrypted=null,
              updated_at=now()
        where id=$1 and tenant_id=$2`,
      [row.user_id, tenantId],
    );
    await client.query(`delete from session where user_id=$1`, [row.user_id]);
    await client.query(
      `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id)
       values($1,'tenant.owner.mfa_reset',$2,$3,$4,'success',$5)`,
      [
        operator,
        tenantId,
        `${slug}/${username}`,
        JSON.stringify({
          userId: row.user_id,
          mfaEnabled: { from: Boolean(before.rows[0]?.mfa_enabled), to: false },
          sessions: { to: 0 },
        }),
        requestId,
      ],
    );
    await client.query("commit");
    console.log(
      `${slug}/${username}: tenant MFA state retired; all sessions revoked; password sign-in remains active`,
    );
  } catch (e) {
    await client.query("rollback");
    await safePlatformAudit("tenant.owner.mfa_reset_failed", tenantId, `${slug}/${username}`, {
      error: message(e),
    });
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Removes only an incomplete provisioning shell so the same slug can be
 * provisioned again. It refuses to touch a tenant that ever accumulated
 * business records; active/archived tenant deletion is intentionally absent.
 */
async function purgeFailedTenant(slug) {
  const client = await pool.connect();
  let tenantId = null;
  try {
    await client.query("begin");
    const found = await client.query(
      `select id,status,provisioning_status from tenants where slug=$1 for update`,
      [slug],
    );
    const tenant = found.rows[0];
    if (!tenant) throw new Error(`tenant not found: ${slug}`);
    tenantId = tenant.id;
    if (tenant.provisioning_status !== "failed" || tenant.status !== "suspended") {
      throw new Error(
        `only suspended tenants with failed provisioning may be purged (status=${tenant.status}, provisioning=${tenant.provisioning_status})`,
      );
    }
    // Discover every tenant-bound table from the live schema so this safety
    // check expands automatically when a new institutional table is added.
    // Only provisioning-shell tables are allowed to contain rows here.
    const shellTables = new Set([
      "user",
      "roles",
      "user_roles",
      "tenant_owners",
      "lookups",
      "institutions",
      "audit_log",
      "platform_audit_log",
    ]);
    const tenantTables = await client.query(`
      select table_name
      from information_schema.columns
      where table_schema='public' and column_name='tenant_id'
      order by table_name`);
    const populatedBusinessTables = [];
    for (const { table_name: tableName } of tenantTables.rows) {
      if (shellTables.has(tableName)) continue;
      const quoted = `"${String(tableName).replaceAll('"', '""')}"`;
      const foundRow = await client.query(
        `select exists(select 1 from ${quoted} where tenant_id=$1 limit 1) as present`,
        [tenantId],
      );
      if (foundRow.rows[0]?.present) populatedBusinessTables.push(tableName);
    }
    if (populatedBusinessTables.length > 0) {
      throw new Error(
        `failed tenant contains business records and cannot be purged automatically: ${populatedBusinessTables.join(", ")}`,
      );
    }

    await client.query(`delete from audit_log where tenant_id=$1`, [tenantId]);
    await client.query(
      `delete from login_attempts la using "user" u where la.user_id=u.id and u.tenant_id=$1`,
      [tenantId],
    );
    await client.query(
      `delete from session s using "user" u where s.user_id=u.id and u.tenant_id=$1`,
      [tenantId],
    );
    await client.query(
      `delete from account a using "user" u where a.user_id=u.id and u.tenant_id=$1`,
      [tenantId],
    );
    await client.query(`delete from tenant_owners where tenant_id=$1`, [tenantId]);
    await client.query(`delete from user_roles where tenant_id=$1`, [tenantId]);
    await client.query(`delete from "user" where tenant_id=$1`, [tenantId]);
    await client.query(
      `delete from role_capabilities rc using roles r where rc.role_id=r.id and r.tenant_id=$1`,
      [tenantId],
    );
    await client.query(`delete from roles where tenant_id=$1`, [tenantId]);
    await client.query(`delete from lookups where tenant_id=$1`, [tenantId]);
    await client.query(`delete from institutions where tenant_id=$1`, [tenantId]);
    await client.query(`update platform_audit_log set tenant_id=null where tenant_id=$1`, [
      tenantId,
    ]);
    await client.query(`delete from tenants where id=$1`, [tenantId]);
    await client.query(
      `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id) values($1,'tenant.failed.purged',null,$2,$3,'success',$4)`,
      [operator, slug, JSON.stringify({ tenantId }), requestId],
    );
    await client.query("commit");
    console.log(`${slug}: failed provisioning shell purged; tenant:create may now be retried`);
  } catch (e) {
    await client.query("rollback");
    await safePlatformAudit("tenant.failed.purge_failed", tenantId, slug, { error: message(e) });
    throw e;
  } finally {
    client.release();
  }
}

async function safePlatformAudit(action, tenantId, target, changes) {
  try {
    await pool.query(
      `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id) values($1,$2,$3,$4,$5,'failure',$6)`,
      [operator, action, tenantId, target, JSON.stringify(changes), requestId],
    );
  } catch (error) {
    console.error(`warning: unable to write failure audit event (${action}): ${message(error)}`);
  }
}
function message(value) {
  return value instanceof Error ? value.message : String(value);
}
function option(values, key) {
  const i = values.indexOf(key);
  return i >= 0 ? values[i + 1]?.trim() : undefined;
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
