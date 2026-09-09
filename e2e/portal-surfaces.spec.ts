import { join } from "node:path";
import { expect, test } from "./support/fixtures";

const authDir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const adminState = join(authDir, "admin-a.json");

/* An ordinary tenant administrator is not a portal subject. These routes must
 * fail closed rather than expose a different user's student or professor
 * record; the dedicated portal-link fixture is exercised by the portal
 * integration tests when a subject identity exists. */
test.describe("portal subject boundaries", () => {
  test.use({ storageState: adminState });

  test("portal landing remains a covered authenticated surface", async ({ page }) => {
    const response = await page.goto("/portal", { waitUntil: "networkidle" });
    expect(response?.status(), "/portal").toBe(200);
  });

  for (const route of ["/portal/professor", "/portal/student"] as const) {
    test(`${route} does not expose an unlinked subject`, async ({ page, allowErrors }) => {
      allowErrors(/responded with a status of 404/);
      const response = await page.goto(route, { waitUntil: "networkidle" });
      /* The portal layout is streamed before its subject lookup can call
       * notFound(). A browser can therefore observe 200 for the committed
       * document even though the final boundary is the application's 404.
       * Accept both transport outcomes, but always require the fail-closed
       * boundary when streaming has already started. */
      expect([404, 200], route).toContain(response?.status());
      if (response?.status() === 200) {
        await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
      }
    });
  }
});
