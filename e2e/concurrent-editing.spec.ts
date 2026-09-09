import { auth, expect, test, unique } from "./support/fixtures";

/**
 * Two clerks, one record, no mercy: the second save carries a version the
 * database no longer honours, and the application must refuse it in words the
 * clerk can act on — never by silently overwriting the first save.
 */

test.use({ storageState: auth("clerk.json") });

const suffix = unique();
const shared = {
  number: `411${(suffix.match(/\d/g) ?? ["7", "7"]).join("").slice(0, 2) || "77"}03`,
  lastName: `کنش‌همزمان-${suffix}`,
};
let recordUrl = "";

test("create the record both clerks will open", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(shared.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("شیرین");
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(shared.lastName);
  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  const statusBox = page.getByRole("combobox", { name: "وضعیت دانشجو" });
  await statusBox.click();
  await page
    .getByRole("option", { name: /در حال تحصیل/ })
    .first()
    .click();
  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  recordUrl = page.url();
});

test("the second, stale save is refused in words, and the first save stands", async ({
  page,
  openObservedPage,
}) => {
  expect(recordUrl, "the setup record must exist before the concurrency assertion").not.toBe("");
  const secondPage = await openObservedPage(auth("clerk.json"));
  const url = `${recordUrl}/edit`;

  /* Both clerks open the record at the same version. */
  await page.goto(url);
  await secondPage.goto(url);
  await expect(page.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toHaveValue(
    shared.lastName,
  );
  await expect(secondPage.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toHaveValue(
    shared.lastName,
  );

  /* Clerk A saves a change. */
  await page
    .getByRole("textbox", { name: "نام خانوادگی", exact: true })
    .fill(`${shared.lastName}-نسخه‌ی-اول`);
  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page).toHaveURL(new RegExp(`${recordUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), {
    timeout: 15_000,
  });

  /* Clerk B, still on the stale form, saves a different change. */
  await secondPage
    .getByRole("textbox", { name: "نام خانوادگی", exact: true })
    .fill(`${shared.lastName}-نسخه‌ی-دوم`);
  await secondPage.getByRole("button", { name: "ذخیره" }).click();

  /* The refusal is the conflict sentence — visible, not a silent success. */
  await expect(
    secondPage.getByText("این پرونده در فاصله‌ی باز کردن و ذخیره‌ی", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(secondPage).toHaveURL(/\/edit$/);

  /* What the database holds is A's version. B's write did not land. */
  const verdict = await page.request.get(recordUrl);
  expect(verdict.status()).toBe(200);
  await page.goto(recordUrl);
  await expect(page.getByText(`${shared.lastName}-نسخه‌ی-اول`).first()).toBeVisible();
  await expect(page.getByText(`${shared.lastName}-نسخه‌ی-دوم`)).toHaveCount(0);
});
