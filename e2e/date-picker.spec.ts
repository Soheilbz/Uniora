import { endOfMonth, format, getDate } from "date-fns-jalali";
import { toLocaleDigits } from "../src/lib/digits";
import { auth, expect, openRegisterSearch, tehranToday, test } from "./support/fixtures";

/**
 * The date picker against the full stack, with the Tehran-midnight boundary
 * as the specific target: a day picked «today» must be stored as Tehran's
 * today — the bug this suite exists to keep dead stored *yesterday* for
 * anything before 03:30 local.
 */

test.use({ storageState: auth("clerk.json") });
test.describe.configure({ mode: "serial" });

let pickedIso = "";
const person = {
  number: "41499007",
  lastName: "تاریخ‌دار-آزمون",
};

async function openPersonEdit(page: import("@playwright/test").Page) {
  /* The register renders first and last name in one cell, so the exact text is
   * not its own node. Scope the action to the matching row instead of using a
   * global first pencil, which could edit a different seeded student. */
  const row = page.getByRole("row").filter({ hasText: person.lastName }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByLabel("ویرایش").click();
}

test("create the record the date tests use", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(person.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("کامران");
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
});

test("the Jalali month renders Jalali day numbers and the complete month", async ({ page }) => {
  await page.goto("/students");
  const search = await openRegisterSearch(page);
  await search.fill(person.number);
  await search.press("Enter");
  await openPersonEdit(page);
  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();

  const trigger = page.getByRole("button", { name: "تاریخ پذیرش" });
  await trigger.click();
  const today = new Date();
  const fullLabel = toLocaleDigits(format(today, "yyyy/MM/dd"), "fa");
  const expectedDay = toLocaleDigits(String(getDate(today)), "fa");
  await expect(page.getByRole("button", { name: fullLabel })).toHaveText(expectedDay);

  const monthPrefix = toLocaleDigits(format(today, "yyyy/MM/"), "fa");
  const monthDays = page.locator(`button[aria-label^="${monthPrefix}"]`);
  expect(await monthDays.count()).toBe(getDate(endOfMonth(today)));
});

test("«today» in the picker stores Tehran's today — never yesterday", async ({ page }) => {
  const expected = tehranToday();

  await page.goto("/students");
  const search = await openRegisterSearch(page);
  await search.fill(person.number);
  await search.press("Enter");
  /* Wait for the narrowed row to render — the click must not race the search's own navigation. */
  await openPersonEdit(page);

  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  /* The picker's trigger is a popover button labelled with its own caption. */
  const trigger = page.getByRole("button", { name: "تاریخ پذیرش" });
  await trigger.click();
  await page.getByRole("button", { name: "امروز" }).click();

  /* The trigger shows the picked day in Persian digits; the hidden input
     carries the ISO value the form posts. */
  const iso = await page.locator('input[name="admissionDate"]').inputValue();
  expect(iso).toBe(expected);
  pickedIso = iso;

  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, { timeout: 15_000 });
});

test("the persisted date survives a reload and reads back identically", async ({ page }) => {
  await page.goto("/students");
  const search = await openRegisterSearch(page);
  await search.fill(person.number);
  await search.press("Enter");
  /* Wait for the narrowed row to render — the click must not race the search's own navigation. */
  await openPersonEdit(page);

  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  /* The trigger keeps its field caption for accessibility after a value is
     selected; the persisted ISO value is the reliable state assertion. */
  const iso = await page.locator('input[name="admissionDate"]').inputValue();
  expect(pickedIso, "the previous test recorded the day it saved").not.toBe("");
  expect(iso).toBe(pickedIso);
});

test("clearing the date empties it for real", async ({ page }) => {
  await page.goto("/students");
  const search = await openRegisterSearch(page);
  await search.fill(person.number);
  await search.press("Enter");
  /* Wait for the narrowed row to render — the click must not race the search's own navigation. */
  await openPersonEdit(page);

  /* The date lives in the academic section, like in the tests above; its
     clear button is the trigger's sibling, reachable from the keyboard.
     Several date fields share the section — take the first. exact:true
     because combobox clears are named «پاک کردن انتخاب»: a substring match
     would hit one of those and clear a lookup instead of the date. */
  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  const clear = page.getByRole("button", { name: "پاک کردن", exact: true }).first();
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(page.locator('input[name="admissionDate"]')).toHaveValue("");

  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, { timeout: 15_000 });

  /* The guarantee is the *stored* value, read back cold: a fresh edit form
     for this record shows an empty date. The save landed on the record page,
     which renders no form — the form lives one URL segment deeper. */
  await page.goto(`${page.url()}/edit`);
  await page.getByRole("button", { name: /اطلاعات تحصیلی/ }).click();
  await expect(page.locator('input[name="admissionDate"]')).toHaveValue("");
});
