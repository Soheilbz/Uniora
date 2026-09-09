import AxeBuilder from "@axe-core/playwright";
import { auth, expect, test } from "./support/fixtures";

async function expectAccessible(page: import("@playwright/test").Page) {
  // Next streams the final server component tree after the initial document
  // response. Axe must inspect the settled route, not the transient shell.
  await page.locator("main").first().waitFor({ state: "visible" });
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length > 0) {
    console.log(
      `axe violations:\n${results.violations
        .map(
          (violation) =>
            `- ${violation.id}: ${violation.help} [${violation.nodes
              .map((node) => `${node.target} ${node.html}`)
              .join(", ")}]`,
        )
        .join("\n")}`,
    );
  }
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

test("sign-in has no automated accessibility violations", async ({ page }) => {
  await page.goto("/sign-in");
  await expectAccessible(page);
});

test("platform sign-in has no automated accessibility violations", async ({ page }) => {
  await page.goto("/platform/sign-in");
  await expectAccessible(page);
});

test.describe("authenticated Platform Console", () => {
  test.use({ storageState: auth("platform.json") });

  for (const [name, path] of [
    ["Platform Console", "/platform"],
    ["Platform audit", "/platform/audit"],
    ["Platform backups", "/platform/backups"],
    ["Platform diagnostics", "/platform/diagnostics"],
  ] as const) {
    test(`${name} has no automated accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }
});

test.describe("authenticated operational surfaces", () => {
  test.use({ storageState: auth("clerk.json") });

  for (const [name, path] of [
    ["dashboard", "/"],
    ["student register", "/students"],
    ["professor register", "/professors"],
    ["council meetings", "/council-meetings"],
    ["council decisions", "/council-decisions"],
    ["workshops", "/workshops"],
    ["worksheets", "/worksheets"],
  ] as const) {
    test(`${name} has no automated accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }
});

test.describe("administrator and sensitive surfaces", () => {
  test.use({ storageState: auth("admin-a.json") });

  for (const [name, path] of [
    ["council meeting form", "/council-meetings/new"],
    ["workshop form", "/workshops/new"],
    ["user management", "/settings/users"],
    ["role management", "/settings/roles"],
    ["import center", "/settings/import"],
    ["data export and backup", "/settings/data"],
    ["audit log", "/settings/audit"],
    ["user print surface", "/print/users"],
  ] as const) {
    test(`${name} has no automated accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }
});

async function expectNoDocumentOverflow(page: import("@playwright/test").Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForLoadState("networkidle");
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(geometry.scrollWidth, `document overflow at ${width}px viewport`).toBeLessThanOrEqual(
    geometry.clientWidth + 1,
  );
}

test.describe("reflow at WCAG-equivalent zoom widths", () => {
  test.use({ storageState: auth("clerk.json") });

  for (const width of [640, 320] as const) {
    test(`student register reflows at ${width}px`, async ({ page }) => {
      await page.goto("/students");
      await expectNoDocumentOverflow(page, width);
    });
  }
});

test.describe("portal accessibility", () => {
  test.use({ storageState: auth("clerk.json") });
  for (const path of ["/portal", "/portal/student", "/portal/professor"] as const) {
    test(`${path} has no automated accessibility violations`, async ({ page }) => {
      await page.goto(path);
      if (page.url().includes("/portal")) await expectAccessible(page);
    });
  }
});

test("public certificate verification surface is accessible", async ({ page }) => {
  await page.goto("/verify/certificate/E2E-INVALID-CODE");
  await expectAccessible(page);
});
