import { auth, expect, state, test } from "./support/fixtures";

const PROPOSAL_SHEETS = [
  "supervisor-selection",
  "doctoral-topic",
  "proposal-defense-request",
  "proposal-defense-schedule",
  "proposal-defense-minutes",
  "proposal-defense-notice",
  "masters-seminar-evaluation",
] as const;

const FINAL_SHEETS = [
  "article-verification",
  "defense-permit",
  "final-defense-schedule",
  "final-defense-evaluation",
  "defense-minutes",
  "originality-declaration",
  "final-defense-notice",
] as const;

function pdfGeometry(pdf: Buffer) {
  const source = pdf.toString("latin1");
  const pages = [...source.matchAll(/\/Type\s*\/Page(?!s)\b/g)].length;
  const mediaBoxes = [
    ...source.matchAll(/\/MediaBox\s*\[\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)\s*\]/g),
  ].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  return { pages, mediaBoxes };
}

function expectA4(pdf: Buffer, onePage: boolean) {
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(8_000);
  const { pages, mediaBoxes } = pdfGeometry(pdf);
  expect(pages).toBeGreaterThan(0);
  if (onePage) expect(pages).toBe(1);
  expect(mediaBoxes.length).toBeGreaterThan(0);
  for (const box of mediaBoxes) {
    // Chromium emits A4 at roughly 595.3 × 841.9 PostScript points.
    expect(box.width).toBeGreaterThan(590);
    expect(box.width).toBeLessThan(601);
    expect(box.height).toBeGreaterThan(837);
    expect(box.height).toBeLessThan(848);
  }
}

async function printWorksheet(
  page: import("@playwright/test").Page,
  sheet: string,
  caseId: string,
) {
  const query = new URLSearchParams({
    q: state.tenantA.studentNumber,
    case: caseId,
    sheet,
    print: "1",
  });
  await page.goto(`/worksheets?${query.toString()}`);
  await expect(page.locator(`article.worksheet-${sheet}`)).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  expectA4(pdf, true);
  return page
    .locator(`article.worksheet-${sheet}`)
    .evaluate((element) => getComputedStyle(element).fontFamily);
}

test.describe("A4 production print output", () => {
  test.use({ storageState: auth("clerk.json") });

  test("all fourteen worksheet instruments produce one A4 page", async ({ page }) => {
    for (const sheet of PROPOSAL_SHEETS) {
      await printWorksheet(page, sheet, state.tenantA.proposalDecisionId);
    }
    for (const sheet of FINAL_SHEETS) {
      const family = await printWorksheet(page, sheet, state.tenantA.finalDecisionId);
      if (sheet === "defense-minutes") {
        expect(family).toContain("Noto Nastaliq Urdu");
      }
    }
  });

  test("research-council minute remains regular Vazirmatn on A4", async ({ page }) => {
    await page.goto(`/council-minutes?meeting=${encodeURIComponent(state.tenantA.meetingNumber)}`);
    const minute = page.locator(".council-minutes-sheet");
    await expect(minute).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const family = await minute.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(family).toContain("Vazirmatn");
    expect(family).not.toContain("Noto Nastaliq Urdu");
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    expectA4(pdf, false);
  });
});
