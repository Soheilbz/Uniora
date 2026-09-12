import { createHmac } from "node:crypto";
import pg from "pg";
import { expect, login, state, test } from "./support/fixtures";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("invalid E2E TOTP secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function currentTotp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * Authentication, end to end: the real form, the real Better Auth route, the
 * real session table, the real lockout ledger. A wrong password here is a
 * wrong password against scrypt, against PostgreSQL — not a stub.
 */

/* Each browser project shares the isolated E2E database, while the real
 * address-level limiter is intentionally shared across requests. Clear only
 * that disposable test ledger between cases so Chromium's attempts cannot
 * make Firefox/WebKit observe a false 429. The production limiter remains
 * fully enabled and is exercised by the lockout test below. */
test.beforeEach(async () => {
  const raw = process.env.E2E_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;
  if (!raw) throw new Error("E2E_ADMIN_URL or DATABASE_ADMIN_URL is required for auth tests");
  const url = new URL(raw);
  url.pathname = `/${process.env.E2E_DB_NAME ?? "univ_web_e2e"}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("delete from rate_limit");
  } finally {
    await client.end();
  }
});

test("valid login lands on a hydrated dashboard", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator('form[data-sign-in-hydrated="true"]')).toBeVisible();
  await page.getByLabel("کد دانشگاه").fill(state.tenantA.slug);
  await page.getByLabel("نام کاربری").fill(state.tenantA.admin.username);
  await page.getByLabel("گذرواژه", { exact: true }).fill(state.tenantA.admin.password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  /* Hydrated, not just rendered: the search trigger is attached because the
     client bundle ran. The attention bell is the dashboard's own data. */
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toBeAttached();
  await expect(page.getByRole("button", { name: "نیاز به توجه" })).toBeVisible();
});

test("invalid password is refused, with no session issued", async ({ page, allowErrors }) => {
  /* A refused credential is a refused HTTP request; the browser logs it. */
  allowErrors(/Failed to load resource/);
  await page.goto("/sign-in");
  await expect(page.locator('form[data-sign-in-hydrated="true"]')).toBeVisible();
  await page.getByLabel("کد دانشگاه").fill(state.tenantA.slug);
  await page.getByLabel("نام کاربری").fill(state.tenantA.admin.username);
  await page.getByLabel("گذرواژه", { exact: true }).fill("definitely-wrong-password");
  await page.getByRole("button", { name: "ورود", exact: true }).click();

  /* The refusal names nothing: same sentence a nonexistent user gets. */
  await expect(page.getByText("نام کاربری یا گذرواژه درست نیست.")).toBeVisible();
  await expect(page).toHaveURL(/sign-in/);
});

test("nonexistent user gets the identical refusal", async ({ page, allowErrors }) => {
  allowErrors(/Failed to load resource/);
  await page.goto("/sign-in");
  await expect(page.locator('form[data-sign-in-hydrated="true"]')).toBeVisible();
  await page.getByLabel("کد دانشگاه").fill(state.tenantA.slug);
  await page.getByLabel("نام کاربری").fill("no-such-person-e2e");
  await page.getByLabel("گذرواژه", { exact: true }).fill("whatever-password-123");
  await page.getByRole("button", { name: "ورود", exact: true }).click();

  await expect(page.getByText("نام کاربری یا گذرواژه درست نیست.")).toBeVisible();
});

test("unauthenticated request to the app is redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
  await expect(page.getByRole("heading", { name: "ورود به سامانه" })).toBeVisible();
});

test("platform operator sign-in is separate from university sign-in", async ({ page }) => {
  await page.goto("/platform/sign-in");
  await expect(page.getByRole("heading", { name: "مدیریت کل سامانه" })).toBeVisible();
  await expect(page.getByLabel("کد دانشگاه")).toHaveCount(0);
  await expect(page.getByLabel("نام کاربری اپراتور")).toBeVisible();
});

test("a university session cannot enter the platform dashboard", async ({ page }) => {
  await login(page, state.tenantA.admin.username, state.tenantA.admin.password);
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/platform\/sign-in/);
});

test("platform MFA setup refuses an unauthenticated browser", async ({ page }) => {
  await page.goto("/platform/security/setup");
  await expect(page).toHaveURL(/\/platform\/sign-in/);
});

test("platform MFA challenge refuses an unauthenticated browser", async ({ page }) => {
  await page.goto("/platform/security/challenge");
  await expect(page).toHaveURL(/\/platform\/sign-in/);
});

test("platform operator can enroll MFA through the real browser flow", async ({ page }) => {
  await page.goto("/platform/sign-in");
  await page.getByLabel("نام کاربری اپراتور").fill(state.platformSetup.username);
  await page.getByLabel("گذرواژه", { exact: true }).fill(state.platformSetup.password);
  await page.getByRole("button", { name: "ورود به مدیریت سامانه", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/security\/setup/);

  await page.getByLabel("گذرواژه‌ی فعلی").fill(state.platformSetup.password);
  await page.getByRole("button", { name: "شروع فعال‌سازی", exact: true }).click();
  const secret = (await page.locator("code").first().textContent())?.trim();
  expect(secret).toBeTruthy();
  await page.getByLabel("کد ۶ رقمی").fill(currentTotp(secret ?? ""));
  await page.getByRole("button", { name: "تأیید و فعال‌سازی", exact: true }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { name: "مدیریت دانشگاه‌ها" })).toBeVisible();
});

test("platform operator can complete the real MFA challenge", async ({ page }) => {
  await page.goto("/platform/sign-in");
  await page.getByLabel("نام کاربری اپراتور").fill(state.platform.username);
  await page.getByLabel("گذرواژه", { exact: true }).fill(state.platform.password);
  await page.getByRole("button", { name: "ورود به مدیریت سامانه", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/security\/challenge/);
  await page.getByLabel("کد ۶ رقمی").fill(currentTotp(state.platform.mfaSecret));
  await page.getByRole("button", { name: "تأیید", exact: true }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { name: "مدیریت دانشگاه‌ها" })).toBeVisible();
});

test("a forged session cookie is refused like no session at all", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: "forged.token-value",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
});

test("session survives a refresh", async ({ page }) => {
  await login(page, state.tenantA.admin.username, state.tenantA.admin.password);
  await page.reload();
  /* Still signed in — the dashboard, not the sign-in redirect. */
  await expect(page.getByRole("button", { name: "نیاز به توجه" })).toBeVisible();
  await expect(page).not.toHaveURL(/sign-in/);
});

test("signing out ends the session for real", async ({ page, allowErrors }) => {
  /* Firefox may report the expected Server Action redirect as an RSC fetch
   * fallback; Chromium/WebKit do not surface that internal navigation detail. */
  allowErrors(/Failed to fetch RSC payload.*Falling back to browser navigation/i);
  allowErrors(/NEXT_REDIRECT/);
  /* Use the reader account for this destructive session test. The auth setup
   * file deliberately supplies the clerk account's cookie to the rest of the
   * suite; signing out as that same account can invalidate the shared fixture
   * session on Better Auth installations configured for one active session.
   * Session revocation is identical for a reader and the test remains isolated
   * from every later authenticated journey. */
  await login(page, state.tenantA.users.reader.username, state.tenantA.users.reader.password);

  /* The account menu at the foot of the sidebar. */
  await page.getByRole("button", { name: "حساب کاربری" }).click();
  await page.getByRole("menuitem", { name: "خروج" }).click();

  /* Where the UI lands afterwards is presentation; the guarantee is that the
     database-backed session is genuinely gone. Session cookie caching is
     disabled, so a direct visit must fail closed immediately. */
  await page.waitForURL(/sign-in/, { timeout: 20_000 });
  await expect(async () => {
    await page.goto("/students");
    await expect(page).toHaveURL(/sign-in/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});

test("the browser favicon is served after an auth redirect", async ({ page }) => {
  const response = await page.request.get("/favicon.ico");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
});

test("the account lockout brake answers, and stays silent about why", async ({
  page,
  allowErrors,
}) => {
  allowErrors(/Failed to load resource/);
  /* Five failures trip the brake; the sixth is refused before any password
     check — and must be indistinguishable from a wrong password. */
  test.slow();
  await page.goto("/sign-in");
  await expect(page.locator('form[data-sign-in-hydrated="true"]')).toBeVisible();
  await page.getByLabel("کد دانشگاه").fill(state.tenantA.slug);
  await page.getByLabel("نام کاربری").fill(state.tenantA.users.reader.username);
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByLabel("گذرواژه", { exact: true }).fill("wrong-password-again");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page.getByText("نام کاربری یا گذرواژه درست نیست.")).toBeVisible();
  }
  /* The correct password, inside the cooldown: still refused, same words. */
  await page.getByLabel("گذرواژه", { exact: true }).fill(state.tenantA.users.reader.password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  await expect(page.getByText("نام کاربری یا گذرواژه درست نیست.")).toBeVisible();
  await expect(page).toHaveURL(/sign-in/);
});
