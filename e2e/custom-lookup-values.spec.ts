import { auth, expect, test, unique } from "./support/fixtures";

test.use({ storageState: auth("admin-a.json") });

test("record-office lookups suggest existing values and accept new ones", async ({ page }) => {
  await page.goto("/professors/new");
  await page.getByRole("button", { name: /اطلاعات علمی/ }).click();

  const value = `دانشکده تازه ${unique()}`;
  const faculty = page.getByRole("combobox", { name: "دانشکده", exact: true });
  await faculty.fill(value);
  await expect(page.getByRole("option", { name: `استفاده از «${value}»` })).toBeVisible();
  await page.getByRole("option", { name: `استفاده از «${value}»` }).click();
  await expect(faculty).toHaveValue(value);
});
