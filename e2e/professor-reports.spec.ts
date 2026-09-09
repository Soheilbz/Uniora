import { auth, expect, test } from "./support/fixtures";

test.use({ storageState: auth("clerk.json") });

test("professor reports render the workload and capacity analysis", async ({ page }) => {
  await page.goto("/professors/reports");

  await expect(page.getByRole("heading", { name: "گزارش‌های اساتید" })).toBeVisible();
  await expect(page.getByText("ترکیب نیروی علمی")).toBeVisible();
  await expect(page.getByText("وضعیت ظرفیت راهنمایی")).toBeVisible();
  await expect(page.getByText("کیفیت داده و اقدام بعدی")).toBeVisible();
  await expect(page.locator('[data-slot="chart"]').first()).toBeVisible();
});
