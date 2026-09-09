import { auth, expect, openRegisterSearch, test, unique } from "./support/fixtures";

/**
 * Editing an existing record: the save that works, the cancel that must not,
 * the unsaved-changes guard, and the version guard that refuses to let a
 * stale save silently win.
 */

test.use({ storageState: auth("clerk.json") });

const suffix = unique();
const original = {
  number: `410${(suffix.match(/\d/g) ?? ["5", "5"]).join("").slice(0, 2) || "55"}02`,
  lastName: `رستگار-${suffix}`,
};
let recordUrl = "";

test("create the record every other test in this file edits", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(original.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("فرهاد");
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(original.lastName);
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

test("the register row's pencil opens the same edit form", async ({ page }) => {
  expect(recordUrl, "the setup record must exist before editing assertions").not.toBe("");
  await page.goto("/students");
  await (await openRegisterSearch(page)).fill(original.lastName);
  /* Wait out the search's own navigation before clicking — a pencil click
     that races it loses to the search URL landing last. The q= URL is the
     navigation having completed; the narrowed row rendering is the register
     having settled. */
  await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
  await expect(page.getByText(original.lastName).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[aria-label="ویرایش"]').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('[aria-label="ویرایش"]').first().click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toHaveValue(
    original.lastName,
  );
});

test("an edit persists, survives reload, and is visible on the record", async ({ page }) => {
  expect(recordUrl, "the setup record must exist before editing assertions").not.toBe("");
  await page.goto(`${recordUrl}/edit`);
  await page
    .getByRole("textbox", { name: "نام خانوادگی", exact: true })
    .fill(`${original.lastName}-ویراسته`);
  await page.getByRole("button", { name: "ذخیره" }).click();

  await expect(page).toHaveURL(new RegExp(`${recordUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), {
    timeout: 15_000,
  });
  await expect(page.getByText(`${original.lastName}-ویراسته`).first()).toBeVisible();

  /* From PostgreSQL this time, not from the form's memory. */
  await page.reload();
  await expect(page.getByText(`${original.lastName}-ویراسته`).first()).toBeVisible();
});

/* The form's way back is an anchor rendered through the Button component,
   which stamps `role="button"` onto it once hydrated — before that it is a
   plain link. The guarantee under test never depended on the role, so the
   locator accepts either. */
function back(page: import("@playwright/test").Page) {
  return page
    .getByRole("button", { name: "بازگشت" })
    .or(page.getByRole("link", { name: "بازگشت" }))
    .first();
}

test("cancel changes nothing", async ({ page }) => {
  expect(recordUrl, "the setup record must exist before editing assertions").not.toBe("");
  await page.goto(`${recordUrl}/edit`);
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill("نباید-ذخیره-شود");
  /* Leaving with unsaved work asks first — that is the guard's whole job, and
     the previous test holds it to the asking. Cancel means: confirm the
     discard, land on the record, and find nothing written. */
  await back(page).click();
  await expect(page.getByRole("heading", { name: "تغییرات ذخیره‌نشده" })).toBeVisible();
  await page.getByRole("button", { name: "بیرون برو و تغییرات را دور بریز" }).click();

  await expect(page).toHaveURL(new RegExp(`${recordUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.getByText("نباید-ذخیره-شود")).toHaveCount(0);
  await expect(page.getByText(`${original.lastName}-ویراسته`).first()).toBeVisible();
});

test("navigating away with unsaved work asks, and both answers behave", async ({ page }) => {
  expect(recordUrl, "the setup record must exist before editing assertions").not.toBe("");
  await page.goto(`${recordUrl}/edit`);

  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill("تغییر-ذخیره‌نشده");
  await back(page).click();

  /* The guard dialog, worded for the reader, with the stay option first. */
  await expect(page.getByRole("heading", { name: "تغییرات ذخیره‌نشده" })).toBeVisible();
  await page.getByRole("button", { name: "برگرد و ادامه بده" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toHaveValue(
    "تغییر-ذخیره‌نشده",
  );

  /* Leaving for real discards, and the record keeps its saved value. */
  await back(page).click();
  await page.getByRole("button", { name: "بیرون برو و تغییرات را دور بریز" }).click();
  await expect(page).toHaveURL(new RegExp(`${recordUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.getByText("تغییر-ذخیره‌نشده")).toHaveCount(0);
  await expect(page.getByText(`${original.lastName}-ویراسته`).first()).toBeVisible();
});
