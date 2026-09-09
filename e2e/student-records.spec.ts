import { auth, expect, openRegisterSearch, test } from "./support/fixtures";

/**
 * Creating a student, the way the office does it: open the form, try to submit
 * nothing, be told what's missing, fill it in, land on the record, and find
 * the same values there after a full reload — through the Server Action, the
 * transaction, the constraints and row-level security, not around any of them.
 */

test.use({ storageState: auth("clerk.json") });

/* Deterministic: the provision rebuilds the database before every run, so
   fixed numbers cannot collide with a previous run's data. */
const student = {
  number: "409000101",
  firstName: "نگار",
  lastName: "همتی-آزمون",
};

test("student reports render the adaptive analytics engine", async ({ page }) => {
  await page.goto("/students/reports");

  await expect(page.getByRole("heading", { name: "گزارش‌های دانشجویان" })).toBeVisible();
  await expect(page.getByText("ترکیب جمعیت فعلی")).toBeVisible();
  await expect(page.getByText("تحلیل cohort پذیرش")).toBeVisible();
  await expect(page.locator('[data-slot="chart"]').first()).toBeVisible();
});

/** The register shows numbers in Persian digits — assert what is shown. */
function toPersian(value: string): string {
  return value.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] ?? digit);
}

test("required fields are refused before anything is written", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("button", { name: "ذخیره" }).click();

  /* The form comes back with the field-level sentences, and nothing navigates. */
  await expect(page.getByText("این فیلد الزامی است").first()).toBeVisible();
  await expect(page).toHaveURL(/students\/new/);
});

test("an invalid national id is rejected by the register's own rules", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(student.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill(student.firstName);
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(student.lastName);
  await page.getByRole("textbox", { name: "کد ملی", exact: true }).fill("1234567890"); // checksum fails
  await page.getByRole("button", { name: "ذخیره" }).click();

  /* The refusal is the national-id sentence, and what was typed is still
     on the form — a refused save must not cost fifty fields of retyping. */
  await expect(page.getByText("کد ملی معتبر نیست").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toHaveValue(
    student.lastName,
  );
  await expect(page).toHaveURL(/students\/new/);
});

test("a valid student is created, shown, and still there after reload", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(student.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill(student.firstName);
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(student.lastName);

  /* «وضعیت دانشجو» is a required vocabulary field: search, then choose. */
  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  const statusBox = page.getByRole("combobox", { name: "وضعیت دانشجو" });
  await statusBox.click();
  await page
    .getByRole("option", { name: /در حال تحصیل/ })
    .first()
    .click();

  await page.getByRole("button", { name: "ذخیره" }).click();

  /* The action redirects to the new record. */
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const recordUrl = page.url();

  await expect(page.getByText(student.lastName).first()).toBeVisible();

  /* Reload: the values came from PostgreSQL, not from the form's memory. */
  await page.reload();
  await expect(page.getByText(student.lastName).first()).toBeVisible();
  await expect(page.getByText(toPersian(student.number)).first()).toBeVisible();
  void recordUrl;
});

test("the new student appears in the register and in global search", async ({ page }) => {
  await page.goto("/students");
  /* The register's search lives inside the filter strip, which starts
     collapsed — opened the way any reader opens it. */
  const search = await openRegisterSearch(page);
  await search.fill(student.lastName);
  await expect(page.getByText(student.lastName).first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/");
  /* The palette opens from the Ctrl+K shortcut; its input does not exist in
     the document until it does. */
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toHaveAttribute(
    "data-search-shortcut-ready",
    "true",
  );
  await page.keyboard.press("Control+KeyK");
  const input = page.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  await expect(input).toBeVisible();
  await input.fill(student.lastName.slice(0, 6));
  await expect(page.getByText(student.lastName).first()).toBeVisible();
});

test("a duplicate student number is refused with the duplicate message", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(student.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("دیگری");
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill("همتا");
  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  const statusBox = page.getByRole("combobox", { name: "وضعیت دانشجو" });
  await statusBox.click();
  await page
    .getByRole("option", { name: /در حال تحصیل/ })
    .first()
    .click();
  await page.getByRole("button", { name: "ذخیره" }).click();

  await expect(page.getByText("این شماره قبلاً ثبت شده است").first()).toBeVisible();
  await expect(page).toHaveURL(/students\/new/);
});
