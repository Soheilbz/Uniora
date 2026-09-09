import { spawn } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import { decryptPlatformOperationSecret } from "../../src/lib/platform-operation-secret.ts";
import { backupKeyringFromEnvironment, inspectBackupDirectory } from "./backup-format.ts";
import {
  PermanentOperationError,
  type PlatformRequestRow,
  record,
  text,
  textOrNull,
} from "./platform-operation-model.ts";

async function runScript(
  script: string,
  args: string[],
  extraEnv: Record<string, string>,
  operatorLabel: string,
  requestId: string,
) {
  await new Promise<void>((resolve, reject) => {
    /* Node 24 is the pinned production runtime and executes the project's
     * erasable TypeScript operational scripts directly. Reusing the same
     * executable here avoids a hidden production dependency on the dev-only
     * `tsx` binary and keeps the production command surface Node-native. */
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLATFORM_OPERATOR: operatorLabel,
        PLATFORM_REQUEST_ID: requestId,
        ...extraEnv,
      },
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const detail = stderr
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !line.startsWith("at ") && !/^Node\.js v\d/.test(line))
          .at(-1);
        const message = detail
          ? `${script}: ${detail}`
          : `${script} exited with code ${code ?? "unknown"}`;
        const publicCode = classifyScriptFailure(message);
        reject(publicCode ? new PermanentOperationError(publicCode, message) : new Error(message));
      }
    });
  });
}

export async function executePlatformOperation(
  pool: import("pg").Pool,
  row: PlatformRequestRow,
  operatorLabel: string,
) {
  const payload = row.payload;
  if (row.kind === "platform.operation.cancel") {
    const targetId = text(payload.targetOperationId);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update platform_operation_requests
            set status='cancelled',result=jsonb_build_object('cancelledBy',$2::text),
                error_message=null,payload=payload - ARRAY['adminPassword','password','__auth'],
                processed_at=now(),updated_at=now()
          where id=$1 and status='queued'
          returning id`,
        [targetId, row.id],
      );
      if (result.rowCount !== 1) {
        throw new PermanentOperationError(
          "operation_not_queued",
          "target operation is no longer queued",
        );
      }
      await client.query(
        `insert into platform_audit_log(operator,action,target,changes,outcome,request_id)
         values($1,'platform.operation.cancelled',$2,$3,'success',$4)`,
        [operatorLabel, targetId, JSON.stringify({ targetOperationId: targetId }), row.id],
      );
      await client.query("commit");
      return { action: "operation.cancelled", targetOperationId: targetId };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  if (row.kind === "platform.operation.retry") {
    const targetId = text(payload.targetOperationId);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        `update platform_operation_requests
            set status='queued',requested_by=$3,
                payload=jsonb_set(payload - '__worker', '{__auth}', $2::jsonb, true),
                result=null,error_message='manual_retry_requested',processed_at=null,updated_at=now()
          where id=$1 and status='failed'
            and kind in ('tenant.rename','tenant.suspend','tenant.resume','tenant.archive','tenant.owner.set','backup.create','backup.verify')
          returning id`,
        [targetId, JSON.stringify(payload.__auth ?? null), row.requestedBy],
      );
      if (result.rowCount !== 1) {
        throw new PermanentOperationError(
          "operation_not_retryable",
          "target operation cannot be retried safely",
        );
      }
      await client.query(
        `insert into platform_audit_log(operator,action,target,changes,outcome,request_id)
         values($1,'platform.operation.retried',$2,$3,'success',$4)`,
        [
          operatorLabel,
          targetId,
          JSON.stringify({ targetOperationId: targetId, reboundRequester: row.requestedBy }),
          row.id,
        ],
      );
      await client.query("commit");
      return { action: "operation.retried", targetOperationId: targetId };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  if (row.kind === "backup.create") {
    await runScript("scripts/platform-backup.mjs", ["create"], {}, operatorLabel, row.id);
    return { action: "backup.created" };
  }
  if (row.kind === "backup.verify") {
    const manifest = latestBackupManifest();
    if (!manifest)
      throw new PermanentOperationError("backup_not_found", "no backup manifest is available");
    await runScript(
      "scripts/platform-backup.mjs",
      ["verify", "--file", manifest],
      {},
      operatorLabel,
      row.id,
    );
    await pool.query(
      `insert into platform_audit_log(operator,action,target,changes,outcome,request_id)
       values($1,'backup.verified',$2,$3,'success',$4)`,
      [operatorLabel, manifest, JSON.stringify({ manifest }), row.id],
    );
    return { action: "backup.verified", manifest };
  }
  const slug = text(payload.slug);
  switch (row.kind) {
    case "tenant.create":
      await runScript(
        "scripts/create-tenant.ts",
        [
          "--slug",
          slug,
          "--name",
          text(payload.name),
          "--admin-username",
          text(payload.adminUsername),
          "--admin-name",
          text(payload.adminName),
        ],
        { TENANT_ADMIN_PASSWORD: decryptPlatformOperationSecret(text(payload.adminPassword)) },
        operatorLabel,
        row.id,
      );
      return { slug, action: "created" };
    case "tenant.suspend":
    case "tenant.resume":
    case "tenant.archive": {
      const command = row.kind.replace("tenant.", "tenant:");
      const args = [command, "--slug", slug];
      if (row.kind === "tenant.archive") args.push("--confirm", `ARCHIVE:${slug}`);
      await runScript("scripts/platform.mjs", args, {}, operatorLabel, row.id);
      return { slug, action: row.kind };
    }
    case "tenant.failed.purge":
      await runScript(
        "scripts/platform.mjs",
        ["tenant:failed:purge", "--slug", slug, "--confirm", `PURGE:${slug}`],
        {},
        operatorLabel,
        row.id,
      );
      return { slug, action: "failed-provisioning-purged" };
    case "tenant.owner.set":
      await runScript(
        "scripts/platform.mjs",
        [
          "tenant:owner:set",
          "--slug",
          slug,
          "--username",
          text(payload.username),
          "--reason",
          text(payload.reason),
          "--confirm",
          `SET-OWNER:${slug}:${text(payload.username)}`,
        ],
        {},
        operatorLabel,
        row.id,
      );
      return { slug, action: "owner-changed" };
    case "tenant.user.create":
      await runScript(
        "scripts/create-tenant-user.ts",
        ["--slug", slug, "--name", text(payload.name), "--username", text(payload.username)],
        { TENANT_USER_PASSWORD: decryptPlatformOperationSecret(text(payload.password)) },
        operatorLabel,
        row.id,
      );
      return { slug, action: "user-created", username: text(payload.username) };
    case "tenant.user.password.reset":
      await runScript(
        "scripts/reset-tenant-user-password.ts",
        ["--slug", slug, "--username", text(payload.username)],
        { TENANT_USER_PASSWORD: decryptPlatformOperationSecret(text(payload.password)) },
        operatorLabel,
        row.id,
      );
      return { slug, action: "user-password-reset", username: text(payload.username) };
    case "tenant.rename": {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const found = await client.query<{ id: string; name: string }>(
          `select id, name from tenants where slug=$1 for update`,
          [slug],
        );
        const tenant = found.rows[0];
        if (!tenant)
          throw new PermanentOperationError("tenant_not_found", `tenant not found: ${slug}`);
        await client.query(`update tenants set name=$1, updated_at=now() where id=$2`, [
          text(payload.name),
          tenant.id,
        ]);
        await client.query(
          `insert into platform_audit_log(operator, action, tenant_id, target, changes, outcome, request_id)
           values($1,'tenant.renamed',$2,$3,$4,'success',$5)`,
          [
            operatorLabel,
            tenant.id,
            slug,
            JSON.stringify({ from: tenant.name, to: text(payload.name) }),
            row.id,
          ],
        );
        await client.query("commit");
        return { slug, action: "renamed" };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    case "break-glass.start": {
      const reason = text(payload.reason).trim();
      const durationMinutes = Number(payload.durationMinutes);
      const notifyTenant = payload.notifyTenant === true;
      if (reason.length < 10 || reason.length > 1000) {
        throw new PermanentOperationError("invalid_payload", "break-glass reason is invalid");
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 30) {
        throw new PermanentOperationError("invalid_payload", "break-glass duration is invalid");
      }
      const authMeta = record(payload.__auth);
      const platformSessionId = textOrNull(authMeta?.sessionId);
      if (!platformSessionId)
        throw new PermanentOperationError(
          "authorization_missing",
          "break-glass request has no platform session",
        );

      const client = await pool.connect();
      try {
        await client.query("begin");
        const tenantResult = await client.query<{ id: string; name: string; status: string }>(
          `select id,name,status from tenants where slug=$1 for update`,
          [slug],
        );
        const tenant = tenantResult.rows[0];
        if (!tenant)
          throw new PermanentOperationError("tenant_not_found", `tenant not found: ${slug}`);
        if (tenant.status === "archived")
          throw new PermanentOperationError(
            "invalid_payload",
            "archived tenant cannot receive break-glass access",
          );

        await client.query(
          `update break_glass_sessions
              set status='expired',ended_at=coalesce(ended_at,expires_at),updated_at=now()
            where tenant_id=$1 and platform_operator_id=$2 and status='active' and expires_at<=now()`,
          [tenant.id, row.requestedBy],
        );
        const inserted = await client.query<{ id: string; expiresAt: Date }>(
          `insert into break_glass_sessions(
             tenant_id,platform_operator_id,platform_session_id,reason,starts_at,expires_at,status
           ) values($1,$2,$3,$4,now(),now()+($5::int*interval '1 minute'),'active')
           returning id,expires_at as "expiresAt"`,
          [tenant.id, row.requestedBy, platformSessionId, reason, durationMinutes],
        );
        const session = inserted.rows[0];
        if (!session) throw new Error("break-glass session insert returned no row");

        if (notifyTenant) {
          await client.query(
            `insert into notifications(tenant_id,user_id,kind,title,body,href,severity)
             select $1,o.user_id,'security.break-glass',
                    'Emergency platform support access started',
                    $2,
                    '/settings/audit','warning'
               from tenant_owners o
              where o.tenant_id=$1
             on conflict do nothing`,
            [
              tenant.id,
              `Platform support (${operatorLabel}) opened time-limited access until ${session.expiresAt.toISOString()}. Reason: ${reason}`,
            ],
          );
          await client.query(
            `update break_glass_sessions set tenant_notified_at=now(),updated_at=now() where id=$1`,
            [session.id],
          );
        }

        await client.query(
          `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id)
           values($1,'break-glass.started',$2,$3,$4,'success',$5)`,
          [
            operatorLabel,
            tenant.id,
            slug,
            JSON.stringify({ breakGlassId: session.id, durationMinutes, notifyTenant, reason }),
            row.id,
          ],
        );
        await client.query("commit");
        return {
          slug,
          action: "break-glass.started",
          breakGlassId: session.id,
          expiresAt: session.expiresAt.toISOString(),
          notifyTenant,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    case "break-glass.end": {
      const breakGlassId = text(payload.breakGlassId);
      const client = await pool.connect();
      try {
        await client.query("begin");
        const ended = await client.query<{ tenantId: string }>(
          `update break_glass_sessions b
              set status='ended',ended_at=now(),updated_at=now()
             from tenants t
            where b.id=$1
              and b.tenant_id=t.id
              and t.slug=$2
              and b.platform_operator_id=$3
              and b.status='active'
            returning b.tenant_id as "tenantId"`,
          [breakGlassId, slug, row.requestedBy],
        );
        const item = ended.rows[0];
        if (!item)
          throw new PermanentOperationError(
            "invalid_payload",
            "active break-glass session was not found",
          );
        await client.query(
          `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome,request_id)
           values($1,'break-glass.ended',$2,$3,$4,'success',$5)`,
          [operatorLabel, item.tenantId, slug, JSON.stringify({ breakGlassId }), row.id],
        );
        await client.query("commit");
        return { slug, action: "break-glass.ended", breakGlassId };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    default:
      throw new PermanentOperationError(
        "unsupported_operation",
        `unsupported platform operation: ${row.kind}`,
      );
  }
}

function latestBackupManifest(): string | null {
  const dir = pathResolve(process.env.BACKUP_DIR?.trim() || "./backups");
  const keyring = backupKeyringFromEnvironment(process.env);
  const catalog = inspectBackupDirectory(dir, keyring);
  if (catalog.invalid.length > 0) {
    throw new PermanentOperationError(
      "backup_catalog_degraded",
      `backup catalog contains ${catalog.invalid.length} invalid artifact(s)`,
    );
  }
  const newest = catalog.healthy[0];
  return newest ? pathResolve(catalog.directory, newest.manifest) : null;
}

function classifyScriptFailure(detail: string): string | null {
  const normalized = detail.toLowerCase();
  if (normalized.includes("tenant slug already exists")) return "tenant_exists";
  if (normalized.includes("tenant not found")) return "tenant_not_found";
  if (
    normalized.includes("target must be an active") ||
    normalized.includes("administrator with mfa")
  )
    return "target_not_eligible";
  if (
    normalized.includes("account not found") ||
    normalized.includes("password credential not found")
  )
    return "account_not_found";
  if (
    normalized.includes("tenant is not active") ||
    normalized.includes("tenant is not fully provisioned") ||
    normalized.includes("only an active tenant") ||
    normalized.includes("only a suspended tenant") ||
    normalized.includes("tenant cannot be archived") ||
    normalized.includes("archived tenant")
  )
    return "tenant_state_conflict";
  if (
    normalized.includes("database_admin_url is required") ||
    normalized.includes("database_url is required") ||
    normalized.includes("better_auth_secret") ||
    normalized.includes("encryption key")
  )
    return "worker_configuration";
  if (normalized.includes("invalid payload") || normalized.includes("invalid account target"))
    return "invalid_payload";
  return null;
}
