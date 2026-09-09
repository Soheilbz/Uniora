import { auth, expect, state, test } from "./support/fixtures";

/**
 * The workshop participant import, through the real file input, the real
 * parser, the real transaction — and the capacity rule that refuses rows
 * rather than quietly overbooking.
 */

test.use({ storageState: auth("admin-a.json") });

const CSV_HEADERS = "شماره دانشجویی,نام\n";

async function uploadAndAdvanceToPreview(
  page: import("@playwright/test").Page,
  fileName: string,
  csv: string,
) {
  await page
    .locator('input[type="file"][aria-labelledby="participant-import-file-label"]')
    .setInputFiles({
      name: fileName,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
  const next = page.getByRole("button", { name: "ادامه", exact: true });
  for (let step = 0; step < 5; step++) {
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();
  }
  await expect(page.getByRole("button", { name: "تأیید واردات", exact: true })).toBeVisible();
}

test("a valid import reports what it did, and the workshop holds the people", async ({ page }) => {
  await page.goto("/settings/import");
  /* Use the fixture's stable identity rather than coupling the test to the
   * localized display label (which may also include the Jalali date). */
  await page.locator('select[name="workshopId"]').selectOption(state.tenantA.workshopId);

  const csv = `${CSV_HEADERS}${state.tenantA.studentNumber},آزمون پایان‌بهار\n`;
  await uploadAndAdvanceToPreview(page, "participants.csv", csv);
  await page.getByRole("button", { name: "تأیید واردات", exact: true }).click();

  /* The report is the honest count, not a generic success. */
  await expect(page.getByText("واردات انجام شد")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("رکورد افزوده‌شده").locator("..")).toContainText("۱");

  /* Persisted: the workshop's own page now lists the participant. */
  await page.goto(`/workshops/${state.tenantA.workshopId}`);
  await expect(page.getByText("پایان‌بهار").first()).toBeVisible();
});

test("re-loading the same file skips, not duplicates", async ({ page }) => {
  await page.goto("/settings/import");
  await page.locator('select[name="workshopId"]').selectOption(state.tenantA.workshopId);
  const csv = `${CSV_HEADERS}${state.tenantA.studentNumber},آزمون پایان‌بهار\n`;
  await uploadAndAdvanceToPreview(page, "participants.csv", csv);
  await page.getByRole("button", { name: "تأیید واردات", exact: true }).click();

  await expect(page.getByText(/واردات/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ردیف نوشته‌نشده").locator("..")).toContainText("۱");

  await page.goto(`/workshops/${state.tenantA.workshopId}`);
  await expect(page.getByText("پایان‌بهار")).toHaveCount(1);
});

test("capacity is enforced: the second seat is refused by name", async ({ page }) => {
  /* Two real students, so the refusal is the capacity rule and not the
     unknown-number check that runs before it. The workshop holds 1 place and
     1 is taken; both rows must be refused, by line. */
  const outsiders = [
    { number: "418000101", name: "مهمان یک" },
    { number: "418000102", name: "مهمان دو" },
  ];
  for (const person of outsiders) {
    await page.goto("/students/new");
    await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(person.number);
    await page.getByRole("textbox", { name: "نام", exact: true }).fill("مهمان");
    await page
      .getByRole("textbox", { name: "نام خانوادگی", exact: true })
      .fill(`${person.name}-${person.number}`);
    await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
    await page.getByRole("combobox", { name: "وضعیت دانشجو" }).click();
    await page
      .getByRole("option", { name: /در حال تحصیل/ })
      .first()
      .click();
    await page.getByRole("button", { name: "ذخیره" }).click();
    await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  }

  await page.goto("/settings/import");
  await page.locator('select[name="workshopId"]').selectOption(state.tenantA.workshopId);

  const csv = `${CSV_HEADERS}${outsiders.map((p) => `${p.number},${p.name}`).join("\n")}\n`;
  await uploadAndAdvanceToPreview(page, "over.csv", csv);

  await expect(page.getByText("ردیف بیش از ظرفیت", { exact: true }).locator("..")).toContainText(
    "۲",
  );
  await expect(page.getByRole("button", { name: "تأیید واردات", exact: true })).toBeDisabled();

  /* And nobody was written: the workshop still holds only its one seat. */
  await page.goto(`/workshops/${state.tenantA.workshopId}`);
  await expect(page.getByText("مهمان یک")).toHaveCount(0);
  await expect(page.getByText("مهمان دو")).toHaveCount(0);
});

test("an unknown student number is a per-row fault, not a silent drop", async ({ page }) => {
  /* A different workshop without capacity pressure: make one via the UI. */
  await page.goto("/workshops/new");
  await page
    .getByRole("textbox", { name: "عنوان کارگاه", exact: true })
    .fill(`کارگاه واردات-${Date.now()}`);
  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page).toHaveURL(/\/workshops\/[0-9a-f-]{36}$/, { timeout: 15_000 });

  await page.goto("/settings/import");
  const select = page.locator('select[name="workshopId"]');
  const made = await expect
    .poll(async () => {
      const options = await select.locator("option").allTextContents();
      return options.find((option) => option.includes("کارگاه واردات-"));
    })
    .toBeTruthy()
    .then(() =>
      select
        .locator("option")
        .allTextContents()
        .then((options) => options.find((option) => option.includes("کارگاه واردات-"))),
    );
  expect(
    made,
    "the workshop created by this test must be present in the import selector",
  ).toBeDefined();
  if (made === undefined) throw new Error("created workshop missing from import selector");
  await select.selectOption({ label: made });

  const csv = `${CSV_HEADERS}999999999,کسی نیست\n`;
  await uploadAndAdvanceToPreview(page, "bad.csv", csv);
  await page.getByRole("button", { name: "تأیید واردات", exact: true }).click();

  await expect(page.getByText("999999999").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ردیف خوانده‌شده").locator("..")).toContainText("۱");
  await expect(page.getByText("ردیف نوشته‌نشده").locator("..")).toContainText("۰");
});
