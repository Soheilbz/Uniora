import { join } from "node:path";
import { expect, type Page, test } from "./support/fixtures";

const authDir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const platformState = join(authDir, "platform.json");
const targetTenantSlug = "e2e-platform";

async function renderedPage(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok(), path).toBeTruthy();
  return response.text();
}

async function waitForRendered(
  page: Page,
  path: string,
  predicate: (html: string) => boolean,
  message: string,
) {
  await expect
    .poll(async () => predicate(await renderedPage(page, path)), {
      timeout: 45_000,
      intervals: [500, 1_000, 2_000],
      message,
    })
    .toBe(true);
}

test.describe
  .serial("platform action workflows", () => {
    test.use({ storageState: platformState });

    test("rename is processed by the worker and appears in audit", async ({ page }) => {
      const name = `دانشگاه آزمون ${Date.now()}`;
      await page.goto("/platform", { waitUntil: "networkidle" });
      const form = page
        .locator("form")
        .filter({ has: page.locator(`input[name="slug"][value="${targetTenantSlug}"]`) })
        .filter({ has: page.locator('input[name="name"]') })
        .first();
      await expect(form).toHaveCount(1);
      await form.locator('input[name="name"]').fill(name);
      await form.getByRole("button").click();
      await expect(page).toHaveURL(/queued=tenant\.rename/);

      await waitForRendered(
        page,
        `/platform/tenants/${targetTenantSlug}`,
        (html) => html.includes(name) && html.includes(">completed<"),
        "tenant rename must be committed and completed by the Platform worker",
      );
      await page.goto(`/platform/audit?action=tenant.renamed&q=${targetTenantSlug}`, {
        waitUntil: "networkidle",
      });
      await expect(
        page.locator("tbody tr").filter({ hasText: "tenant.renamed" }).first(),
      ).toContainText(name);
    });

    test("tenant lifecycle suspend and resume are durable", async ({ page }) => {
      await page.goto("/platform", { waitUntil: "networkidle" });
      const suspend = page
        .locator('form:has(input[name="action"][value="tenant.suspend"])')
        .first();
      await expect(suspend).toHaveCount(1);
      await suspend.getByRole("button").click();
      await expect(page).toHaveURL(/queued=tenant\.suspend/);
      await waitForRendered(
        page,
        "/platform",
        (html) => html.includes('value="tenant.resume"'),
        "tenant suspension must complete before resume is offered",
      );
      await waitForRendered(
        page,
        `/platform/tenants/${targetTenantSlug}`,
        (html) => html.includes(">completed<"),
        "tenant suspension must be recorded as completed",
      );

      await page.goto("/platform", { waitUntil: "networkidle" });
      const resume = page.locator('form:has(input[name="action"][value="tenant.resume"])').first();
      await expect(resume).toHaveCount(1);
      await resume.getByRole("button").click();
      await expect(page).toHaveURL(/queued=tenant\.resume/);
      await waitForRendered(
        page,
        "/platform",
        (html) => html.includes('value="tenant.suspend"'),
        "tenant resume must restore the active lifecycle state",
      );
      await waitForRendered(
        page,
        `/platform/tenants/${targetTenantSlug}`,
        (html) => html.includes(">completed<"),
        "tenant resume must be recorded as completed",
      );
    });

    test("break-glass start and end are worker-backed and audited", async ({ page }) => {
      await page.goto("/platform/break-glass", { waitUntil: "networkidle" });
      const start = page.locator('form:has(textarea[name="reason"])').first();
      await start
        .locator('textarea[name="reason"]')
        .fill("بررسی عملیاتی کنترل‌شده برای تست recovery");
      await start.getByRole("button").click();
      await expect(page).toHaveURL(/queued=break-glass\.start/);
      await waitForRendered(
        page,
        "/platform/break-glass",
        (html) => html.includes('name="breakGlassId"'),
        "break-glass start must create an active session",
      );

      await page.goto("/platform/break-glass", { waitUntil: "networkidle" });
      const end = page.locator('form:has(input[name="breakGlassId"])').first();
      await expect(end).toHaveCount(1);
      await end.getByRole("button").click();
      await expect(page).toHaveURL(/queued=break-glass\.end/);
      await waitForRendered(
        page,
        "/platform/break-glass",
        (html) => !html.includes('name="breakGlassId"'),
        "break-glass end must revoke the active session",
      );
    });

    test("backup creation is queued, verified, and listed", async ({ page }) => {
      await page.goto("/platform", { waitUntil: "networkidle" });
      const create = page.locator('form:has(input[name="action"][value="create"])').first();
      await expect(create).toHaveCount(1);
      await create.getByRole("button").click();
      await expect(page).toHaveURL(/queued=backup\.create/);
      await waitForRendered(
        page,
        "/platform/backups",
        (html) => html.includes(".dump.enc.json"),
        "backup create must produce a verified inventory entry",
      );
    });
  });
