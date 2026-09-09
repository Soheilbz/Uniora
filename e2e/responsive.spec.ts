import { auth, expect, openRegisterSearch, state, test } from "./support/fixtures";

/**
 * The same real workflows at four real viewport sizes. Not screenshots —
 * each size must remain *usable*: the controls exist, are visible, and the
 * primary flow completes.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

test.use({ storageState: auth("clerk.json") });

for (const viewport of VIEWPORTS) {
  test(`register workflow at ${viewport.name} (${viewport.width}×${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/students");

    /* The register's core controls are present and on screen. */
    await expect(page.getByRole("heading", { name: "دانشجویان" })).toBeVisible();
    const search = await openRegisterSearch(page);
    await expect(search).toBeVisible();
    await expect(search).toBeInViewport();

    /* The workflow: search, open, come back. The q= URL is the search's own
       navigation having completed — a pencil click that races it loses to the
       search URL landing last, at every viewport. */
    await search.fill(state.tenantA.studentName);
    await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
    await expect(page.getByText(state.tenantA.studentName).first()).toBeVisible({
      timeout: 10_000,
    });

    await page.locator('[aria-label="ویرایش"]').first().click();
    await expect(page).toHaveURL(/\/edit$/);

    /* The form is usable at this width: the fields are on screen. */
    await expect(page.getByRole("textbox", { name: "نام خانوادگی", exact: true })).toBeInViewport();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "دانشجویان" })).toBeVisible();
  });

  test(`dialog workflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "جست‌وجو" })).toHaveAttribute(
      "data-search-shortcut-ready",
      "true",
    );
    await page.keyboard.press("Control+KeyK");
    const input = page.getByPlaceholder(
      "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
    );
    await expect(input).toBeVisible();
    await expect(input).toBeInViewport();
    await page.keyboard.press("Escape");

    /* On a phone the navigation collapses behind a toggle — it must open. */
    if (viewport.width < 768) {
      const toggle = page.getByRole("button", { name: "باز و بستن نوار کناری" });
      await expect(toggle, "mobile navigation must expose its sidebar toggle").toBeVisible();
      await toggle.click();
      await expect(page.getByRole("link", { name: "دانشجویان" })).toBeVisible();
    }
  });
}
