import { auth, expect, test } from "./support/fixtures";

/**
 * Failure, seen through the user's eyes. The application must never spin
 * forever, never report false success, never show raw database errors — and
 * never lose what the user typed because a save was refused.
 */

test.use({ storageState: auth("clerk.json") });

test("a missing record answers with the not-found boundary, in the reader's language", async ({
  page,
}) => {
  await page.goto("/students/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f");
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
  await expect(page.getByText("این صفحه وجود ندارد")).toBeVisible();
  /* The way out is offered, in the shell — not a bare 404 with a dead end. */
  await expect(page.getByText("بازگشت به داشبورد")).toBeVisible();
});

test("a garbage id answers the same way — no stack, no raw error", async ({
  page,
  allowErrors,
}) => {
  allowErrors(/Failed to load resource/);
  await page.goto("/students/not-a-uuid-at-all");
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
  const body = await page.textContent("body");
  expect(body ?? "").not.toContain("postgres");
  expect(body ?? "").not.toContain("Exception");
  expect(body ?? "").not.toContain("at ");
});

test("a refused save keeps every field the user typed", async ({ page }) => {
  await page.goto("/students/new");
  const typed = `بدون‌وضعیت-${Date.now()}`;
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill("416000001");
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("ناتمام");
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(typed);
  await page.getByRole("textbox", { name: "کد ملی", exact: true }).fill("1234567890"); // invalid checksum
  await page.getByRole("button", { name: "ذخیره" }).click();

  await expect(page.getByText("کد ملی معتبر نیست").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toHaveValue(typed);
  await expect(page.getByRole("textbox", { name: "کد ملی", exact: true })).toHaveValue(
    "1234567890",
  );
});

test("an unknown route renders the root not-found boundary", async ({ page, allowErrors }) => {
  allowErrors(/Failed to load resource/);
  await page.goto("/no-such-screen-e2e");
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
  await expect(page.getByText("این صفحه وجود ندارد")).toBeVisible();
});

test("a signed-out session redirects to sign-in instead of erroring", async ({
  openObservedPage,
}) => {
  /* This flow revokes its session. Keep it on the dedicated owner fixture so
   * it cannot invalidate the clerk cookie shared by the following suites. */
  const page = await openObservedPage(auth("owner.json"));
  await page.goto("/");
  await page.getByRole("button", { name: "حساب کاربری" }).click();
  await page.getByRole("menuitem", { name: "خروج" }).click();
  await page.waitForURL(/sign-in/);
  await page.goto("/students");
  await expect(page).toHaveURL(/sign-in/);
});
