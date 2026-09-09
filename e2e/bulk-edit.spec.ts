import { auth, expect, openRegisterSearch, test, unique } from "./support/fixtures";

/**
 * Bulk edit across a selection: the count it reports is the count it wrote,
 * and the values land in the database.
 */

test.use({ storageState: auth("clerk.json") });

const suffix = unique();
const batch = {
  a: {
    number: `415${(suffix.match(/\d/g) ?? ["1", "1"]).join("").slice(0, 2) || "11"}08`,
    lastName: `گروهی-الف-${suffix}`,
  },
  b: {
    number: `415${(suffix.match(/\d/g) ?? ["2", "2"]).join("").slice(0, 2) || "22"}09`,
    lastName: `گروهی-ب-${suffix}`,
  },
};

test("create the two records the bulk edit will change", async ({ page }) => {
  for (const person of [batch.a, batch.b]) {
    await page.goto("/students/new");
    await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(person.number);
    await page.getByRole("textbox", { name: "نام", exact: true }).fill("گروهی");
    await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(person.lastName);
    await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
    const statusBox = page.getByRole("combobox", { name: "وضعیت دانشجو" });
    await statusBox.click();
    await page
      .getByRole("option", { name: /در حال تحصیل/ })
      .first()
      .click();
    await page.getByRole("button", { name: "ذخیره" }).click();
    await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  }
});

test("ticking two rows and applying a bulk edit changes exactly two", async ({ page }) => {
  await page.goto("/students");
  await (await openRegisterSearch(page)).fill("گروهی-");
  await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
  await expect(page.getByRole("checkbox", { name: "انتخاب این ردیف" })).toHaveCount(2);

  await page.getByRole("checkbox", { name: "انتخاب این ردیف" }).first().click();
  await page.getByRole("checkbox", { name: "انتخاب این ردیف" }).last().click();
  await page.getByRole("button", { name: "ویرایش گروهی" }).click();

  await expect(page.getByRole("heading", { name: "ویرایش رکوردهای انتخاب‌شده" })).toBeVisible();
  await expect(page.getByText(/۲ رکورد/)).toBeVisible();

  /* The dialog opens on its first allow-listed field (وضعیت دانشجو); pick the
     value from its combobox — the control is a Combobox, not a native select.
     The target differs from what both records already carry: the action skips
     rows that already hold the value, and a no-op must not read as a change. */
  await page.getByRole("combobox", { name: "مقدار جدید" }).click();
  await page.getByRole("option", { name: "مرخصی تحصیلی" }).first().click();
  await page.getByRole("button", { name: "اعمال تغییر" }).click();

  await expect(page.getByText("۲ رکورد تغییر کرد")).toBeVisible({ timeout: 15_000 });

  /* Persisted: both records come back carrying the new status — read off the
     register row itself, which is the value as PostgreSQL has it, through the
     same RLS-scoped query every reader uses. */
  for (const person of [batch.a, batch.b]) {
    await page.goto("/students");
    await (await openRegisterSearch(page)).fill(person.lastName);
    const row = page.locator("tbody tr").filter({ hasText: person.lastName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row).toContainText("مرخصی تحصیلی");
  }
});
