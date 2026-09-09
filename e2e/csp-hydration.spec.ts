import { expect, login, openRegisterSearch, state, test } from "./support/fixtures";

/**
 * The CSP regression: the exact bug that took the application down.
 *
 * A static `script-src 'self'` served every byte of every page while
 * forbidding the inline scripts that turn them into an application — the
 * stream-swap that replaces the loading spinner, the hydration that makes
 * buttons work. The result was a product that looked served and did nothing.
 *
 * This test does not inspect headers. It proves *execution*: sign in through
 * the form, watch the loading state resolve into a rendered dashboard,
 * navigate on the client, open and dismiss a dialog, flip the theme — and
 * fail if the browser reported a single CSP refusal, console error, hydration
 * failure or uncaught exception along the way. The fixture does the watching;
 * this test does the living.
 */

test("the application is alive after sign-in: hydrated, navigable, interactive", async ({
  page,
}) => {
  /* 1. Real sign-in through the form. */
  await page.goto("/sign-in");
  await page.getByLabel("کد دانشگاه").fill(state.tenantA.slug);
  await page.getByLabel("نام کاربری").fill(state.tenantA.admin.username);
  await page.getByLabel("گذرواژه", { exact: true }).fill(state.tenantA.admin.password);
  await page.getByRole("button", { name: "ورود", exact: true }).click();
  /* Password hashing is intentionally expensive. Under the supported
     multi-shard run, four isolated servers may verify credentials at once;
     allow the real auth operation to finish without weakening the assertion. */
  await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });

  /* 2. The dashboard's streamed content replaced the loading boundary — the
     inline $RC swap ran, which a static CSP forbids. */
  await expect(page.getByRole("button", { name: "نیاز به توجه" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toBeAttached();

  /* 3. Hydration actually completed: React is answering for the page.
     document.readyState alone proves nothing; a React-rendered interactive
     control responding does. */
  await page.getByRole("button", { name: "جست‌وجو" }).click();
  const palette = page.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  /* 4. Client-side navigation — the router, not a document load. */
  const navigation = page.waitForURL(/\/students/);
  await page.getByRole("link", { name: "دانشجویان" }).first().click();
  await navigation;
  await expect(page.getByRole("heading", { name: "دانشجویان" })).toBeVisible();

  /* 5. A dialog opens and closes — focus management, portals, all client-side. */
  await (await openRegisterSearch(page)).fill(state.tenantA.studentName);
  const deleteButton = page.getByRole("button", { name: /حذف —/ }).first();
  await expect(
    deleteButton,
    "the administrator must have an interactive delete control",
  ).toBeVisible();
  await deleteButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  /* 6. Theme initialization: next-themes resolves `system` to a concrete class. */
  const themeClasses = await page.evaluate(() => [...document.documentElement.classList]);
  expect(themeClasses.some((name) => name === "light" || name === "dark")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("fa");
});

test("a full reload of an authenticated page hydrates with zero refusals", async ({ page }) => {
  await login(page, state.tenantA.admin.username, state.tenantA.admin.password);
  await page.goto("/students");
  await page.reload();

  await expect(page.getByRole("heading", { name: "دانشجویان" })).toBeVisible();

  /* Interactive after reload: the search box narrows the table. */
  await (await openRegisterSearch(page)).fill(state.tenantA.studentName);
  await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
  await expect(page.getByText(state.tenantA.studentName).first()).toBeVisible({ timeout: 10_000 });
});
