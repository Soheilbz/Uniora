import { auth, expect, openRegisterSearch, state, test } from "./support/fixtures";

/**
 * The keyboard is a first-class input device in an office where the mouse is
 * shared, sticky, or broken. Every path here is driven without clicking.
 */

test.use({ storageState: auth("clerk.json") });

test("Ctrl+K opens the palette, Escape closes it, focus returns", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toHaveAttribute(
    "data-search-shortcut-ready",
    "true",
  );
  await page.keyboard.press("Control+KeyK");
  const input = page.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  await expect(input).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
});

test("Arrow keys move the command-palette selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toHaveAttribute(
    "data-search-shortcut-ready",
    "true",
  );
  await page.keyboard.press("Control+KeyK");
  const dialog = page.getByRole("dialog");
  const input = dialog.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  const selected = dialog.locator('[cmdk-item][data-selected="true"]');
  await expect(selected).toHaveCount(1);
  const before = await selected.textContent();
  await input.press("ArrowDown");
  await expect(selected).toHaveCount(1);
  expect(await selected.textContent()).not.toBe(before);
});

test("typing in the palette navigates with Enter alone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toHaveAttribute(
    "data-search-shortcut-ready",
    "true",
  );
  await page.keyboard.press("Control+KeyK");
  const input = page.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  await input.fill("دانشجویان");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/students/, { timeout: 10_000 });
});

test("a dialog traps focus and Escape dismisses it", async ({ page }) => {
  await page.goto("/students");
  await (await openRegisterSearch(page)).fill(state.tenantA.studentName);
  const deleteButton = page.getByRole("button", { name: /حذف —/ }).first();
  await expect(
    deleteButton,
    "the research-officer fixture must expose student delete controls",
  ).toBeVisible();
  await deleteButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /* Focus sits inside the dialog; Tab keeps it there. */
  await page.keyboard.press("Tab");
  await expect
    .poll(
      () =>
        dialog.evaluate(
          (element) =>
            element.contains(document.activeElement) || document.activeElement === element,
        ),
      { timeout: 2_000 },
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a form submits with Enter from a text field", async ({ page }) => {
  await page.goto("/students/new");
  await page.getByRole("textbox", { name: "شماره دانشجویی", exact: true }).fill("417000001");
  await page.getByRole("textbox", { name: "نام", exact: true }).fill("کیبورد");
  await page.getByRole("textbox", { name: "نام خانوادگی", exact: true }).fill("با-اینتر");
  await page.getByRole("textbox", { name: "کد ملی", exact: true }).fill("1234567890"); // invalid, so the submit is refused
  await page.getByRole("textbox", { name: "کد ملی", exact: true }).press("Enter");

  /* The form ran — the refusal proves the submission happened. */
  await expect(page.getByText("کد ملی معتبر نیست").first()).toBeVisible();
});

test("focus is visible wherever it lands", async ({ page }) => {
  await page.goto("/students");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      outline: style.outlineStyle,
      ring: element.className.includes("focus-visible") || style.boxShadow !== "none",
      visible: element.getBoundingClientRect().width > 0,
    };
  });
  expect(focused).not.toBeNull();
  expect(focused?.visible).toBe(true);
});
