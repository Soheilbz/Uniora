import AxeBuilder from "@axe-core/playwright";
import { auth, expect, test } from "./support/fixtures";

const settingsRoutes = [
  "/settings",
  "/settings/appearance",
  "/settings/institution",
  "/settings/lookups",
  "/settings/users",
  "/settings/roles",
  "/settings/ownership",
  "/settings/audit",
  "/settings/data",
  "/settings/import",
  "/settings/data-quality",
  "/settings/about",
] as const;

async function expectAccessible(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations,
    results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target).join(", ")})`,
      )
      .join("\n"),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth, `${page.url()} has horizontal overflow`).toBeLessThanOrEqual(
    metrics.clientWidth + 1,
  );
}

test.describe("settings surfaces", () => {
  test.use({ storageState: auth("admin-a.json") });

  test("all sections render accessibly without horizontal overflow", async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1248, height: 912 });
    for (const route of settingsRoutes) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectAccessible(page);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("the settings shell remains usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/lookups");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "تنظیمات" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });

  test("the institution form keeps controls inside their card at desktop width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1248, height: 912 });
    await page.goto("/settings/institution");
    const input = page.locator("#institution-name");
    await expect(input).toBeVisible();
    const bounds = await input.evaluate((element) => {
      const card = element.closest('[data-slot="card"]');
      if (!card) throw new Error("institution input is not inside a settings card");
      const inputRect = element.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return { inputRight: inputRect.right, cardRight: cardRect.right };
    });
    expect(bounds.inputRight).toBeLessThanOrEqual(bounds.cardRight + 1);
    await expectNoHorizontalOverflow(page);
  });

  test("critical settings controls have programmatic labels", async ({ page }) => {
    await page.goto("/settings/institution");
    for (const id of [
      "institution-timezone",
      "institution-locale",
      "institution-calendar-system",
      "institution-session-hours",
      "institution-password-min-length",
    ]) {
      const labelCount = await page
        .locator(`#${id}`)
        .evaluate((element: HTMLInputElement | HTMLSelectElement) => element.labels?.length ?? 0);
      expect(labelCount, `${id} must have a programmatic label`).toBeGreaterThan(0);
    }
  });

  test("critical settings reflow at the 400-percent equivalent width", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    for (const route of ["/settings/institution", "/settings/ownership"] as const) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    }
  });

  test("database backup controls are absent from tenant settings", async ({ page }) => {
    await page.goto("/settings/data");
    await expect(page.getByText(/pg_dump|پشتیبان.*پایگاه داده/i)).toHaveCount(0);
    await expect(
      page.getByLabel("تنظیمات").getByRole("link", { name: /export|خروجی/i }),
    ).toBeVisible();
  });
});

test.describe("security workflow routes", () => {
  test.use({ storageState: auth("admin-a.json") });

  test("security workflow routes fail closed or render accessibly without server errors", async ({
    page,
  }) => {
    for (const route of ["/change-password", "/security/setup", "/security/challenge"] as const) {
      const response = await page.goto(route);
      expect(response?.status() ?? 500).toBeLessThan(500);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).toBeVisible();
      if (route === "/security/setup" || route === "/security/challenge") {
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator("#mfa-challenge-code, #mfa-enrollment-code")).toHaveCount(0);
      } else {
        await expectAccessible(page);
      }
    }
  });
});
