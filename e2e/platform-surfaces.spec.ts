import { join } from "node:path";
import { expect, test } from "./support/fixtures";

const authDir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const platformState = join(authDir, "platform.json");

test.describe("platform console surface", () => {
  test.use({ storageState: platformState });

  test("/platform/break-glass renders for an elevated platform operator", async ({ page }) => {
    const response = await page.goto("/platform/break-glass", { waitUntil: "networkidle" });
    expect(response?.status(), "/platform/break-glass").toBe(200);
    await expect(page.locator("main")).toBeVisible();
  });

  for (const route of [
    "/platform/backups",
    "/platform/operations",
    "/platform/audit",
    "/platform/diagnostics",
  ] as const) {
    test(`${route} renders for an elevated platform operator`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator("main")).toBeVisible();
    });
  }

  test("/platform/tenants/univ renders the university control detail", async ({ page }) => {
    const response = await page.goto("/platform/tenants/univ", { waitUntil: "networkidle" });
    expect(response?.status(), "/platform/tenants/univ").toBe(200);
    await expect(page.locator("main")).toBeVisible();
  });
});
