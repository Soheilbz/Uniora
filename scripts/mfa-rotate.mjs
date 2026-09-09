/** Re-encrypt stored MFA envelopes under the active MFA key id. */
import pg from "pg";
import { activeMfaKeyId, needsMfaReencrypt, reencryptMfaSecret } from "../src/lib/mfa.ts";

const { Client } = pg;
const url = process.env.DATABASE_ADMIN_URL?.trim();
const operator = process.env.PLATFORM_OPERATOR?.trim();
if (!url) fail("DATABASE_ADMIN_URL is required");
if (!operator) fail("PLATFORM_OPERATOR is required");
if (process.env.MFA_ROTATION_CONFIRM !== "ROTATE_MFA_KEYS") {
  fail("MFA rotation requires MFA_ROTATION_CONFIRM=ROTATE_MFA_KEYS");
}

const client = new Client({ connectionString: url, application_name: "univ-mfa-rotation" });
await client.connect();
try {
  await client.query("begin");
  const result = await client.query(`
    select id, mfa_secret_encrypted, mfa_pending_secret_encrypted
      from "user"
     where mfa_secret_encrypted is not null
        or mfa_pending_secret_encrypted is not null
     order by id
     for update
  `);
  let changed = 0;
  for (const row of result.rows) {
    const active = row.mfa_secret_encrypted;
    const pending = row.mfa_pending_secret_encrypted;
    const nextActive = active && needsMfaReencrypt(active) ? reencryptMfaSecret(active) : active;
    const nextPending =
      pending && needsMfaReencrypt(pending) ? reencryptMfaSecret(pending) : pending;
    if (nextActive === active && nextPending === pending) continue;
    await client.query(
      `update "user"
          set mfa_secret_encrypted=$2,
              mfa_pending_secret_encrypted=$3,
              updated_at=now()
        where id=$1`,
      [row.id, nextActive, nextPending],
    );
    changed += 1;
  }
  await client.query(
    `insert into platform_audit_log(operator,action,target,changes,outcome)
     values($1,'auth.mfa.keys.rotated',$2,$3,'success')`,
    [operator, activeMfaKeyId(), JSON.stringify({ reencryptedUsers: changed })],
  );
  await client.query("commit");
  console.log(JSON.stringify({ activeKeyId: activeMfaKeyId(), reencryptedUsers: changed }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
