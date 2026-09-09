import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/*
 * Build a disposable, multi-tenant load fixture.  This is intentionally not a
 * seed and cannot be pointed at an ordinary development or production
 * database by accident: the operator must provide a scale-named database URL
 * and an explicit confirmation.  It creates 100 universities and 50 staff
 * identities per university, then issues one synthetic session per tenant so
 * the HTTP probe can exercise tenant selection rather than one tenant 5,000
 * times.
 *
 * Example (on a disposable PostgreSQL database):
 *   SCALE_CONFIRM=I_UNDERSTAND_TEST_DATABASE \
 *   SCALE_DATABASE_ADMIN_URL=postgresql://.../univ_web_scale \
 *   SCALE_STATE_FILE=.univ/runtime/scale-fixture.json \
 *   node scripts/scale-fixture.mjs
 *
 * The passwords are never printed and the generated session cookies are only
 * written to the state file.  Do not run this against a real database.
 */

const adminUrl = process.env.SCALE_DATABASE_ADMIN_URL?.trim() ?? "";
if (process.env.SCALE_CONFIRM !== "I_UNDERSTAND_TEST_DATABASE") {
  fail("SCALE_CONFIRM must equal I_UNDERSTAND_TEST_DATABASE.");
}
if (!adminUrl) fail("SCALE_DATABASE_ADMIN_URL is required.");
const authSecret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
if (authSecret.length < 32) fail("BETTER_AUTH_SECRET is required to sign test sessions.");
let parsed;
try {
  parsed = new URL(adminUrl);
} catch {
  fail("SCALE_DATABASE_ADMIN_URL must be a PostgreSQL URL.");
}
if (!parsed.pathname.match(/scale|e2e/i)) {
  fail("SCALE_DATABASE_ADMIN_URL database name must contain scale or e2e.");
}

const universityCount = 100;
const staffPerUniversity = 50;
const cookieName =
  process.env.SCALE_SECURE_COOKIES === "1"
    ? "__Secure-better-auth.session_token"
    : "better-auth.session_token";
const tenants = [];
const db = new pg.Client({ connectionString: adminUrl });
await db.connect();
try {
  await db.query("BEGIN");
  const existing = await db.query(
    "select count(*)::int as count from tenants where slug like 'scale-%'",
  );
  if (existing.rows[0]?.count) {
    fail("Scale tenants already exist in this database; recreate the disposable database first.");
  }

  const sample = await db.query(
    `select password, issuer, provider_id
       from account
      where password is not null
      limit 1`,
  );
  const credential = sample.rows[0];
  if (!credential?.password) {
    fail("A seeded credential hash is required; seed the disposable database first.");
  }

  for (let index = 1; index <= universityCount; index += 1) {
    const slug = `scale-${String(index).padStart(3, "0")}`;
    const tenant = await db.query(`insert into tenants (slug, name) values ($1, $2) returning id`, [
      slug,
      `دانشگاه آزمون ${index}`,
    ]);
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) fail(`Could not create ${slug}.`);
    await db.query("insert into institutions (tenant_id, name) values ($1, $2)", [
      tenantId,
      `دانشگاه آزمون ${index}`,
    ]);
    const role = await db.query(
      `insert into roles (tenant_id, key, name, tier, is_system)
       values ($1, 'scale-reader', 'کارمند آزمون', 0, true)
       returning id`,
      [tenantId],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) fail(`Could not create role for ${slug}.`);
    await db.query(
      "insert into role_capabilities (role_id, capability) values ($1, 'students.view'), ($1, 'professors.view')",
      [roleId],
    );

    const sessionToken = randomUUID();
    const userIds = [];
    for (let staff = 1; staff <= staffPerUniversity; staff += 1) {
      const suffix = `${String(index).padStart(3, "0")}_${String(staff).padStart(2, "0")}`;
      const userId = `scale-user-${suffix}`;
      const username = `scale_${suffix}`;
      userIds.push(userId);
      await db.query(
        `insert into "user"
          (id, name, email, email_verified, username, display_username, tenant_id, created_at, updated_at)
         values ($1, $2, $3, false, $4, $4, $5, now(), now())`,
        [userId, `کارمند ${suffix}`, `${username}@scale.invalid`, username, tenantId],
      );
      await db.query(
        `insert into account
          (id, user_id, issuer, account_id, provider_id, password, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())`,
        [
          `scale-account-${suffix}`,
          userId,
          credential.issuer,
          userId,
          credential.provider_id,
          credential.password,
        ],
      );
      await db.query("insert into user_roles (user_id, role_id, tenant_id) values ($1, $2, $3)", [
        userId,
        roleId,
        tenantId,
      ]);
    }
    await db.query(
      `insert into session
        (id, user_id, token, expires_at, created_at, updated_at)
       values ($1, $2, $3, now() + interval '8 hours', now(), now())`,
      [`scale-session-${String(index).padStart(3, "0")}`, userIds[0], sessionToken],
    );
    tenants.push({
      slug,
      sessionCookie: `${cookieName}=${encodeURIComponent(`${sessionToken}.${signCookie(sessionToken, authSecret)}`)}`,
    });
  }
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const stateFile = process.env.SCALE_STATE_FILE?.trim() || ".univ/runtime/scale-fixture.json";
const destination = resolve(root, stateFile);
const privateStateRoot = `${resolve(root, ".univ")}${sep}`;
if (!destination.startsWith(privateStateRoot)) {
  fail("SCALE_STATE_FILE must stay inside the project .univ directory.");
}
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(
  destination,
  JSON.stringify(
    {
      database: parsed.pathname.slice(1),
      universities: universityCount,
      staffPerUniversity,
      totalStaff: universityCount * staffPerUniversity,
      cookies: tenants.map((tenant) => tenant.sessionCookie),
    },
    null,
    2,
  ),
);
console.log(
  `scale fixture ready: ${universityCount} universities, ${universityCount * staffPerUniversity} staff`,
);
console.log(`state file: ${stateFile}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function signCookie(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64");
}
