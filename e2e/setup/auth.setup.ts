import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import pg from "pg";
import { canonicalAuthUsername, canonicalPlatformUsername } from "../../src/lib/auth-username";
import { state } from "../support/fixtures";

/**
 * Signs the suite's role accounts and Platform operator in through the *real* sign-in endpoint and
 * stores the resulting session cookies.
 *
 * This is not a mock of authentication: it is the same HTTP call the sign-in
 * form makes, going through the same Better Auth route, the same account
 * lockout guard and the same session table. The tests then reuse these real
 * session cookies instead of re-typing credentials in every one of them —
 * the login form itself is exercised thoroughly in `auth.spec.ts`.
 */

/* Per-group overrides; unset means the classic single run. */
const dir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3021";

async function signInAndStore(
  request: APIRequestContext,
  tenantSlug: string,
  username: string,
  password: string,
  file: string,
) {
  /* The sign-in route is rate-limited — deliberately, in production code. A
     real client respects a 429 and backs off; so does the suite. */
  let response = await request.post("/api/auth/sign-in/username", {
    data: { username: canonicalAuthUsername(tenantSlug, username), password },
  });
  for (let attempt = 0; response.status() === 429 && attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    response = await request.post("/api/auth/sign-in/username", {
      data: { username: canonicalAuthUsername(tenantSlug, username), password },
    });
  }
  expect(response.status(), `sign-in for ${username}`).toBe(200);
  writeFileSync(file, JSON.stringify(await request.storageState()));
}

async function markSessionMfa(userId: string) {
  const client = new pg.Client({ connectionString: e2eAdminUrl() });
  await client.connect();
  try {
    await client.query(
      `update session
          set mfa_verified_at = now(), elevated_until = now() + interval '15 minutes'
        where id = (
          select id from session where user_id = $1 order by created_at desc limit 1
        )`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

function e2eAdminUrl(): string {
  let raw = process.env.E2E_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;
  if (!raw) {
    const envPath = join(process.cwd(), ".env.database.local");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index < 0 || trimmed.slice(0, index).trim() !== "DATABASE_ADMIN_URL") continue;
        raw = trimmed.slice(index + 1).trim();
        break;
      }
    }
  }
  if (!raw) throw new Error("DATABASE_ADMIN_URL is required for Platform E2E auth setup");
  const url = new URL(raw);
  url.pathname = `/${process.env.E2E_DB_NAME ?? "univ_web_e2e"}`;
  return url.toString();
}

async function signInPlatformAndStore(
  request: APIRequestContext,
  username: string,
  password: string,
  userId: string,
  file: string,
) {
  let response = await request.post("/api/auth/sign-in/username", {
    data: { username: canonicalPlatformUsername(username), password },
  });
  for (let attempt = 0; response.status() === 429 && attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    response = await request.post("/api/auth/sign-in/username", {
      data: { username: canonicalPlatformUsername(username), password },
    });
  }
  expect(response.status(), `platform sign-in for ${username}`).toBe(200);

  /* This changes only the freshly rebuilt E2E database. It does not bypass a
   * production endpoint: the password sign-in is real, and only the test
   * session's MFA attestation is stamped so browser tests can reach the
   * protected Platform Console. */
  const client = new pg.Client({ connectionString: e2eAdminUrl() });
  await client.connect();
  try {
    const result = await client.query(
      `update session
          set mfa_verified_at = now(), elevated_until = now() + interval '15 minutes'
        where id = (
          select id from session where user_id = $1 order by created_at desc limit 1
        )`,
      [userId],
    );
    expect(result.rowCount, "fresh Platform session must exist").toBe(1);
  } finally {
    await client.end();
  }
  writeFileSync(file, JSON.stringify(await request.storageState()));
}

test("create authenticated sessions for every role", async ({ playwright }) => {
  if (!existsSync(dir)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
  }

  const admin = await playwright.request.newContext({ baseURL });
  await signInAndStore(
    admin,
    state.tenantA.slug,
    state.tenantA.admin.username,
    state.tenantA.admin.password,
    join(dir, "admin-a.json"),
  );
  await admin.dispose();

  const owner = await playwright.request.newContext({ baseURL });
  await signInAndStore(
    owner,
    state.tenantA.slug,
    state.tenantA.users.owner.username,
    state.tenantA.users.owner.password,
    join(dir, "owner.json"),
  );
  /* This dedicated logout fixture is a tenant owner, so its disposable
   * session needs the same one-time MFA attestation as the platform fixture.
   * The production MFA gate is not changed. */
  await markSessionMfa(state.tenantA.users.ids.ownerId);
  await owner.storageState({ path: join(dir, "owner.json") });
  await owner.dispose();

  const clerk = await playwright.request.newContext({ baseURL });
  await signInAndStore(
    clerk,
    state.tenantA.slug,
    state.tenantA.users.clerk.username,
    state.tenantA.users.clerk.password,
    join(dir, "clerk.json"),
  );
  await clerk.dispose();

  const reader = await playwright.request.newContext({ baseURL });
  await signInAndStore(
    reader,
    state.tenantA.slug,
    state.tenantA.users.reader.username,
    state.tenantA.users.reader.password,
    join(dir, "reader.json"),
  );
  await reader.dispose();

  const adminB = await playwright.request.newContext({ baseURL });
  await signInAndStore(
    adminB,
    state.tenantB.slug,
    state.tenantB.admin.username,
    state.tenantB.admin.password,
    join(dir, "admin-b.json"),
  );
  await adminB.dispose();

  const platform = await playwright.request.newContext({ baseURL });
  await signInPlatformAndStore(
    platform,
    state.platform.username,
    state.platform.password,
    state.platform.userId,
    join(dir, "platform.json"),
  );
  await platform.dispose();
});
