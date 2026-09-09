import AxeBuilder from "@axe-core/playwright";
import { auth, expect, test } from "./support/fixtures";

/**
 * Every register uses the shared toolbar/table engine, but each one has its
 * own columns, joins and empty-state copy. Keep a smoke check for every public
 * register so a change made for students cannot quietly break the other
 * offices or introduce page-level horizontal overflow. A wide register is
 * allowed to scroll inside its table viewport: column pinning and user-sized
 * columns make that an intentional, contained interaction rather than a page
 * layout failure.
 */

test.use({ storageState: auth("clerk.json") });

const REGISTERS = [
  ["/students", "دانشجویان"],
  ["/professors", "اساتید"],
  ["/workshops", "کارگاه‌ها"],
  ["/council-meetings", "جلسات شورا"],
  ["/council-decisions", "مصوبات شورا"],
] as const;

for (const [path, title] of REGISTERS) {
  test(`${title} register keeps the shared shell usable`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);

    await expect(page.getByRole("heading", { name: title }).first()).toBeVisible();
    await expect(page.getByRole("toolbar")).toBeVisible();

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations,
      `${path} has accessibility violations: ${accessibility.violations.map((item) => item.id).join(", ")}`,
    ).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} must not overflow the page viewport`).toBeLessThanOrEqual(1);

    const tableOverflow = await page
      .locator('[data-slot="table-container"]')
      .evaluateAll((tables) =>
        tables.map((table) => ({
          scrollWidth: table.scrollWidth,
          clientWidth: table.clientWidth,
          overflowX: getComputedStyle(table).overflowX,
        })),
      );
    expect(
      tableOverflow.every(
        ({ clientWidth, overflowX }) =>
          clientWidth > 0 && (overflowX === "auto" || overflowX === "scroll"),
      ),
      `${path} table overflow must stay inside a usable scroll container`,
    ).toBe(true);
    expect(consoleErrors, `${path} emitted browser errors`).toEqual([]);
  });
}
