import { auth, expect, openRegisterSearch, test, unique } from "./support/fixtures";

/**
 * Retiring a record: the confirmation that stands between a click and a
 * person's removal from the register — and the refusal path that must say
 * something rather than look like success.
 */

test.use({ storageState: auth("clerk.json") });

const suffix = unique();
const doomed = {
  number: `412${(suffix.match(/\d/g) ?? ["8", "8"]).join("").slice(0, 2) || "88"}04`,
  lastName: `حذف‌شدنی-${suffix}`,
};
const kept = {
  number: `412${(suffix.match(/\d/g) ?? ["9", "9"]).join("").slice(0, 2) || "99"}05`,
  lastName: `ماندگار-${suffix}`,
};
let doomedUrl = "";

async function createStudent(
  page: import("@playwright/test").Page,
  person: { number: string; lastName: string },
) {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(person.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("آزمایشی");
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

/* The row's delete control names the whole person — «حذف — نام نام خانوادگی» —
   so the needle is the surname, not the label's first word. */
function deleteButton(page: import("@playwright/test").Page, lastName: string) {
  return page.getByRole("button", { name: new RegExp(`حذف — .*${lastName}`) });
}

/** Search the register and wait out the search's own navigation before
    acting on what it narrowed to — clicking mid-navigation races it. */
async function searchFor(page: import("@playwright/test").Page, lastName: string) {
  await page.goto("/students");
  await (await openRegisterSearch(page)).fill(lastName);
  await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
  await expect(page.getByText(lastName).first()).toBeVisible({ timeout: 10_000 });
}

test("create the two records the deletion tests use", async ({ page }) => {
  await createStudent(page, doomed);
  doomedUrl = page.url();
  await createStudent(page, kept);
});

test("cancel in the confirmation dialog changes nothing", async ({ page }) => {
  expect(doomedUrl, "the setup record must exist before deletion assertions").not.toBe("");
  await searchFor(page, doomed.lastName);
  await expect(deleteButton(page, doomed.lastName)).toBeVisible();
  await deleteButton(page, doomed.lastName).click();

  /* The dialog names the record before it asks. */
  await expect(page.getByRole("heading", { name: "حذف این رکورد" })).toBeVisible();
  await page.getByRole("button", { name: "انصراف" }).click();

  /* Nothing was written: the record is still in the register. */
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await (await openRegisterSearch(page)).fill(doomed.lastName);
  await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
  await expect(page.getByText(doomed.lastName).first()).toBeVisible();
});

test("confirming the dialog removes the record, and says nothing false", async ({ page }) => {
  expect(doomedUrl, "the setup record must exist before deletion assertions").not.toBe("");
  await searchFor(page, doomed.lastName);
  await deleteButton(page, doomed.lastName).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف", exact: true }).click();

  /* The row leaves the register. */
  await expect(page.getByText(doomed.lastName)).toHaveCount(0);

  /* And the record itself is gone from the database, not just hidden: its URL
     now answers with the not-found boundary. */
  await page.goto(doomedUrl);
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
});

test("a reader without the manage capability sees no delete at all", async ({
  openObservedPage,
}) => {
  const page = await openObservedPage(auth("reader.json"));
  await searchFor(page, kept.lastName);
  await expect(page.getByText(kept.lastName).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /حذف —/ })).toHaveCount(0);
});
