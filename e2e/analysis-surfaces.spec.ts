import { join } from "node:path";
import { expect, test } from "./support/fixtures";

/*
 * The shared register suite proves the shell and the core registers. These are
 * the secondary analytical/print-entry surfaces that are easy to leave
 * out of a browser pass: they must load with the real session, stay inside the
 * viewport, and emit no browser-side errors.
 */
const authDir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const adminState = join(authDir, "admin-a.json");

test.describe("analytical and worksheet surfaces", () => {
  test.use({ storageState: adminState });

  for (const path of [
    "/professor-capacity",
    "/professor-capacity/reports",
    "/reviewer-counts",
    "/reviewer-counts/reports",
    "/council-meetings/reports",
    "/council-decisions/reports",
    "/settings/data-quality",
    "/worksheets",
  ]) {
    test(`${path} loads without browser errors or page overflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      /* App Router streaming can keep a connection open after the page is
         complete. DOM readiness plus the main landmark is the product
         contract here; network-idle is not and made this smoke test flaky. */
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      expect(errors, errors.join("\n")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => document.documentElement.clientWidth),
      );
    });
  }
});
