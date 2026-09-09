import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/fixtures";

const authDir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const adminState = join(authDir, "admin-a.json");

/* Every non-parameterised, authenticated page in the current release. Detail
 * pages are covered by their domain specs because they need a seeded id. */
const routes = [
  "/",
  "/calendar",
  "/calendar/subscriptions",
  "/forbidden",
  "/correspondence",
  "/council-checklist",
  "/council-decisions",
  "/council-decisions/new",
  "/council-decisions/appointments/new",
  "/council-decisions/rulings/new",
  "/council-decisions/reports",
  "/council-meetings",
  "/council-meetings/new",
  "/council-meetings/reports",
  "/council-minutes",
  "/documents",
  "/notifications",
  "/print/audit",
  "/print/lookups",
  "/print/users",
  "/professors",
  "/professors/reports",
  "/professor-capacity",
  "/professor-capacity/reconcile",
  "/professor-capacity/reports",
  "/reviewer-counts",
  "/reviewer-counts/cases",
  "/reviewer-counts/reports",
  "/research-projects",
  "/settings",
  "/settings/about",
  "/settings/appearance",
  "/settings/audit",
  "/settings/data",
  "/settings/data-quality",
  "/settings/institution",
  "/settings/api",
  "/settings/custom-fields",
  "/settings/decision-templates",
  "/settings/features",
  "/settings/integrations",
  "/settings/lookups",
  "/settings/master-data",
  "/settings/portals",
  "/settings/regulations",
  "/settings/retention",
  "/settings/roles",
  "/settings/scheduled-jobs",
  "/settings/users",
  "/students",
  "/students/reports",
  "/tasks",
  "/workshops",
  "/workshops/reports",
  "/worksheets",
] as const;

test.describe("authenticated route surface", () => {
  test.use({ storageState: adminState });

  for (const path of routes) {
    test(`${path} responds cleanly`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      const response = await page.goto(path, {
        /* Next's link prefetching and other normal client activity can keep the
         * network busy after the surface is fully rendered. DOM readiness is
         * the meaningful availability contract; the assertions below verify
         * the response, main content, errors, accessibility, and layout. */
        waitUntil: "domcontentloaded",
      });
      expect(response?.status(), path).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      /* Streaming server-rendered surfaces can expose <main> before the
       * route's heading is attached in WebKit. Wait for the actual semantic
       * readiness marker before running the accessibility contract. */
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(errors, `${path}\n${errors.join("\n")}`).toEqual([]);

      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(
        accessibility.violations,
        accessibility.violations
          .map((violation) => `${violation.id}: ${violation.help}`)
          .join("\n"),
      ).toEqual([]);

      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(dimensions.width, `${path} overflows horizontally`).toBeLessThanOrEqual(
        dimensions.viewport,
      );
    });
  }
});
