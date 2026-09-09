import { toLocaleDigits } from "../src/lib/digits.ts";
import { auth, expect, test, unique } from "./support/fixtures";

/**
 * Global search against real records: exact and partial Persian, digits,
 * no-results, several result kinds — and the stale-response race, where an
 * older query's answer must never overwrite a newer one.
 */

test.use({ storageState: auth("clerk.json") });

const suffix = unique();
const probe = {
  number: `413${(suffix.match(/\d/g) ?? ["3", "3"]).join("").slice(0, 2) || "33"}06`,
  lastName: `جست‌وجوپذیر-${suffix}`,
};

test("create a record with a name only this test searches for", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill(probe.number);
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("مهتاب");
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill(probe.lastName);
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

async function openSearch(page: import("@playwright/test").Page) {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "جست‌وجو" });
  await expect(trigger).toHaveAttribute("data-search-shortcut-ready", "true");
  await page.keyboard.press("Control+KeyK");
  const input = page.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  await expect(input).toBeVisible();
  return input;
}

test("an exact Persian name finds the record", async ({ page }) => {
  const input = await openSearch(page);
  await input.fill(probe.lastName);
  await expect(page.getByText(probe.lastName).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("dialog").getByText("دانشجویان", { exact: true })).toBeVisible();
});

test("a partial name finds it too — the trigram index answers infix queries", async ({ page }) => {
  const input = await openSearch(page);
  /* A true infix of the Persian name, with the joiner removed: the fold
     renders it as a space, and a needle starting with one never matches. */
  await input.fill(probe.lastName.replace(/\u200c/g, "").slice(4, 8));
  await expect(page.getByText(probe.lastName).first()).toBeVisible({ timeout: 10_000 });
});

test("digits find the student by number", async ({ page }) => {
  const input = await openSearch(page);
  await input.fill(probe.number);
  /* The empty state echoes the query — which here *is* the number — so the
     echo must be gone before the visible number means a real hit. */
  await expect(page.getByText("نتیجه‌ای برای", { exact: false })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByText(toLocaleDigits(probe.number, "fa")).first()).toBeVisible({
    timeout: 10_000,
  });
});

test("a query with no answer says so instead of showing stale results", async ({ page }) => {
  const input = await openSearch(page);
  await input.fill("zzz-no-such-thing-zzz");
  await expect(page.getByText("نتیجه‌ای برای", { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(probe.lastName)).toHaveCount(0);
});

test("several kinds of result come back in one palette", async ({ page }) => {
  const input = await openSearch(page);
  await input.fill("دانشجوی");
  /* Scoped to the palette: the sidebar behind it carries the same word, and
     an unscoped match would resolve to both and fail on strictness. */
  await expect(page.getByRole("dialog").getByText("دانشجویان", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

test("rapid consecutive queries land on the newest answer, never an older one", async ({
  page,
}) => {
  const input = await openSearch(page);
  /* Fire three queries back to back with no waiting between them. The race
     the suite guards against: an older, wider answer resolving after a newer,
     narrower one and overwriting it on screen. */
  await input.fill(probe.lastName);
  await input.fill(probe.number);
  await input.fill("zzz-no-such-thing-zzz");

  /* The final state must be the final query's: nothing found. */
  await expect(page.getByText("نتیجه‌ای برای", { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(probe.lastName)).toHaveCount(0);
  await expect(page.getByText(probe.number)).toHaveCount(0);
});

test("choosing a search result navigates to the record", async ({ page }) => {
  const input = await openSearch(page);
  await input.fill(probe.lastName);
  /* The «نتیجه‌ای برای …» empty state echoes the query back, so a bare text
     wait can be satisfied by the echo before any answer arrives. Wait for
     the answer: the echo must be gone, then the hit present. */
  await expect(page.getByText("نتیجه‌ای برای", { exact: false })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByText(probe.lastName).first()).toBeVisible({ timeout: 10_000 });
  await input.press("Enter");
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}$/, { timeout: 10_000 });
});
