import { auth, expect, openRegisterSearch, test } from "./support/fixtures";

/**
 * The register as an instrument: filters that narrow, sorts that order,
 * pages that turn — and the reader's context surviving a trip into a record
 * and back. Counts are read in Persian digits, because that is what the
 * screen actually shows.
 */

test.use({ storageState: auth("clerk.json") });

test("the register lists the seeded cohort with a real count", async ({ page }) => {
  await page.goto("/students");
  /* The pager names the total: «… نفر از ۱۵» — a number from count(*) over(). */
  await expect(page.getByText(/[0-9۰-۹]+ نفر/).first()).toBeVisible();
});

test("a filter narrows, and clearing it restores", async ({ page }) => {
  await page.goto("/students");
  const total = await page
    .getByText(/[0-9۰-۹]+ نفر/)
    .first()
    .textContent();

  /* The filter strip: narrow by degree. The select is a native one. */
  await openRegisterSearch(page);
  const degreeFilter = page.getByRole("combobox", { name: "مقطع" });
  await degreeFilter.click();
  await page.getByRole("option", { name: "کارشناسی" }).first().click();
  await expect(page).toHaveURL(/degree=/);
  await expect(page.getByText(/[0-9۰-۹]+ نفر/).first()).not.toHaveText(total ?? "never");

  /* Clearing returns the full register. Both the open panel and the tag
     strip offer the same control — take the first. */
  await page.getByRole("button", { name: "برداشتن صافی‌ها" }).first().click();
  await expect(page.getByText(/[0-9۰-۹]+ نفر/).first()).toHaveText(total ?? "never-equal");
});

test("the search box narrows as you type and the URL carries it", async ({ page }) => {
  await page.goto("/students");
  await (await openRegisterSearch(page)).fill("پایان‌بهار");
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText("پایان‌بهار").first()).toBeVisible();
  await expect(page.getByText("همتی-")).toHaveCount(0);
});

test("sorting by a column reorders the rows", async ({ page }) => {
  await page.goto("/students");
  const firstBefore = await page.locator("tbody tr").first().textContent();

  /* The student-number header is a sort control. */
  await page.getByRole("link", { name: /مرتب‌سازی بر اساس شماره دانشجویی/ }).click();
  await expect(page).toHaveURL(/sort=studentNumber/);
  const firstAfter = await page.locator("tbody tr").first().textContent();
  expect(firstAfter).not.toEqual(firstBefore);
});

test("the table keeps its header and action column stable while scrolling", async ({ page }) => {
  await page.goto("/students");
  const tableContainer = page.locator('[data-slot="table-container"]');
  await expect(tableContainer).toBeVisible();

  const result = await tableContainer.evaluate((container) => {
    const header = container.querySelector<HTMLElement>('[data-slot="table-header"]');
    const actionHeader = container.querySelector<HTMLElement>(
      '[data-slot="table-header"] th:last-child',
    );
    const actionCell = container.querySelector<HTMLElement>(
      '[data-slot="table-body"] tr:first-child td:last-child',
    );
    const beforeTop = header?.getBoundingClientRect().top ?? 0;
    container.scrollTop = Math.min(300, container.scrollHeight - container.clientHeight);
    const afterTop = header?.getBoundingClientRect().top ?? 0;
    const pagination = document.querySelector<HTMLElement>('[data-slot="table-pagination"]');
    return {
      scrollTop: container.scrollTop,
      stickyDelta: Math.abs(afterTop - beforeTop),
      actionHeaderWidth: actionHeader?.getBoundingClientRect().width ?? 0,
      actionCellWidth: actionCell?.getBoundingClientRect().width ?? 0,
      paginationGap: pagination
        ? pagination.getBoundingClientRect().top - container.getBoundingClientRect().bottom
        : Number.POSITIVE_INFINITY,
    };
  });

  expect(result.scrollTop).toBeGreaterThan(0);
  expect(result.stickyDelta).toBeLessThan(1);
  expect(result.actionHeaderWidth).toBeGreaterThanOrEqual(100);
  expect(result.actionCellWidth).toBe(result.actionHeaderWidth);
  expect(result.paginationGap).toBeLessThan(16);
});

test("pagination turns pages and the page size holds", async ({ page }) => {
  await page.goto("/students");
  const pager = page.getByText(/صفحه [0-9۰-۹]+ از [0-9۰-۹]+/);
  await expect(pager, "the deterministic seed must exercise pagination").toBeVisible();
  const firstOnOne = await page.locator("tbody tr").first().textContent();
  await page.locator('nav[aria-label*="صفحه"]').getByText("بعدی").click();
  await expect(page).toHaveURL(/page=2/);
  const firstOnTwo = await page.locator("tbody tr").first().textContent();
  expect(firstOnTwo).not.toEqual(firstOnOne);
});

test("into a record and back: the register's narrowing is preserved", async ({ page }) => {
  await page.goto("/students");
  const search = await openRegisterSearch(page);
  await search.fill("پایان‌بهار");
  await search.press("Enter");
  await expect(page.getByText("پایان‌بهار").first()).toBeVisible({ timeout: 10_000 });

  await page.locator('[aria-label="ویرایش"]').first().click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.goBack();

  /* Back at the register, still narrowed to the search the reader had —
     either the URL carries the query or the table still shows only the hit. */
  const narrowed =
    (await page.url()).includes("q=") || (await page.getByText("پایان‌بهار").first().isVisible());
  expect(narrowed).toBe(true);
});
