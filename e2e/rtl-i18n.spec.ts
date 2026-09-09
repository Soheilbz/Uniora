import { auth, expect, openRegisterSearch, test } from "./support/fixtures";

/**
 * Two locales, one application: the interface must actually switch —
 * direction, words, validation sentences — not merely claim to.
 */

test.use({ storageState: auth("clerk.json") });

test("the Persian interface is right-to-left with Persian words", async ({ page }) => {
  await page.goto("/students");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.getByRole("heading", { name: "دانشجویان" })).toBeVisible();
  /* The register's own words, not English defaults — inside the filter strip,
     which starts collapsed and is opened the way a reader opens it. */
  await expect(await openRegisterSearch(page)).toBeAttached();
});

test("switching the account's language flips the whole interface", async ({ page }) => {
  await page.goto("/settings/appearance");

  /* The language control on the appearance screen — a real setting saved to
     the account, not a cookie-only shortcut. */
  const english = page.getByRole("button", { name: /انگلیسی/ });
  await expect(english).toBeVisible();
  await english.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en", { timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText("Students").first()).toBeVisible();

  /* A validation sentence is localized too, not just the chrome. */
  await page.goto("/students/new");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("This field is required").first()).toBeVisible();

  /* And back — the suite's other tests expect Persian. */
  await page.goto("/settings/appearance");
  const persian = page.getByRole("button", { name: /Persian/ });
  await expect(persian).toBeVisible();
  await persian.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "fa", { timeout: 15_000 });
});

test("the sign-in screen renders in English under the locale cookie", async ({ page }) => {
  /* The one screen that must localize before an account exists — it reads
     the cookie, not the account. Clear this browser's session before visiting
     it so the assertion does not depend on a sidebar menu animation. */
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([{ name: "univ-locale", value: "en", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "University administration, in one place" }),
  ).toBeVisible();
  await expect(page.getByText("Secure connection and encrypted authentication")).toBeVisible();
});
