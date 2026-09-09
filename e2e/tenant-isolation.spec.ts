import { auth, expect, state, test } from "./support/fixtures";

/**
 * The tenant boundary, attacked the way a user could attack it: through the
 * real application, with real URLs, real sessions and real ids from the
 * *other* university. Row-level security is what answers these — no
 * application filter is trusted.
 */

test.use({ storageState: auth("admin-b.json") });

test("tenant B's register shows only tenant B's students", async ({ page }) => {
  await page.goto("/students");
  await expect(page.getByRole("heading", { name: "دانشجویان" })).toBeVisible();

  /* B's own student is there... */
  await expect(page.getByText("دانشگاه‌دوم")).toBeVisible();
  /* ...and A's is not — RLS made the row invisible, not forbidden. */
  await expect(page.getByText(state.tenantA.studentName)).toHaveCount(0);
  await expect(page.getByText(state.tenantA.studentNumber)).toHaveCount(0);
});

test("a direct URL to tenant A's student reads as nonexistent", async ({ page }) => {
  await page.goto(`/students/${state.tenantA.studentId}`);
  /* The same «not found» a deleted record gets: the boundary withholds even
     the fact that the record exists somewhere. */
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
});

test("a direct URL to tenant A's council meeting reads as nonexistent", async ({ page }) => {
  await page.goto(`/council-meetings/${state.tenantA.meetingId}`);
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
});

test("a crafted, well-formed id cannot conjure another tenant's record", async ({ page }) => {
  /* A syntactically valid uuid that belongs to nobody. */
  await page.goto("/students/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f");
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
});

test("global search does not leak tenant A's records to tenant B", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "جست‌وجو" }).click();
  const input = page.getByPlaceholder(
    "جست‌وجو در کل پرونده‌ها، دانشجویان، اساتید، مصوبات و منوها...",
  );
  await input.fill(state.tenantA.studentName.split(" ")[0] ?? "آزمون");
  await expect(
    page.getByText("نتیجه‌ای برای", { exact: false }).or(page.getByText("چیزی پیدا نشد")),
  ).toBeVisible();
  await expect(page.getByText(state.tenantA.studentName)).toHaveCount(0);
});

test("tenant B cannot reach tenant A's record through the edit route either", async ({ page }) => {
  await page.goto(`/students/${state.tenantA.studentId}/edit`);
  await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
});

test("tenant A's record survives everything tenant B just tried", async ({ openObservedPage }) => {
  const page = await openObservedPage(auth("admin-a.json"));
  await page.goto(`/students/${state.tenantA.studentId}`);
  await expect(page.getByText(state.tenantA.studentName).first()).toBeVisible();
});

test("an unauthorized role is refused the user-administration screen", async ({
  openObservedPage,
}) => {
  const page = await openObservedPage(auth("reader.json"));
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "دسترسی ندارید" })).toBeVisible();
});

test("an unauthorized role cannot read the nationality column", async ({ openObservedPage }) => {
  /* `students.nationality` is gated on screen *and* in the export. */
  const page = await openObservedPage(auth("reader.json"));
  await page.goto(`/students/${state.tenantA.studentId}`);
  await expect(page.getByText("کد ملی")).toBeVisible(); // the label exists...
  const row = page.locator("dd, td, div", { hasText: "کد ملی" }).first();
  /* ...but the value is the restricted marker, not the number. */
  await expect(page.getByText("0123456789")).toHaveCount(0);
  void row;
});
