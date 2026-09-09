import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, isExpectedRscAccessCheck, test } from "./support/fixtures";

const authDir = process.env.E2E_AUTH_DIR ?? join(process.cwd(), "e2e", ".auth");
const adminState = join(authDir, "admin-a.json");

/*
 * Detail routes are deliberately discovered from the rendered register rather
 * than guessed from fixture ids. That keeps this a real wiring test: a page
 * whose row points at the wrong href, or whose detail route stops accepting a
 * valid current record, fails here without duplicating seed knowledge.
 */
type Surface = {
  list?: string;
  direct?: string;
  prefix: string;
  editable: boolean;
  expectedStatus?: number;
};

const sources: readonly Surface[] = [
  { list: "/students", prefix: "/students/", editable: true },
  { list: "/professors", prefix: "/professors/", editable: true },
  { list: "/workshops", prefix: "/workshops/", editable: true },
  {
    list: "/workshops?tab=certificates",
    prefix: "/workshops/certificates/",
    editable: false,
  },
  {
    direct: "/platform/support/not-a-tenant-id",
    prefix: "/platform/support/",
    editable: false,
    expectedStatus: 404,
  },
  {
    direct: "/verify/certificate/E2E-INVALID-CODE",
    prefix: "/verify/certificate/",
    editable: false,
    expectedStatus: 200,
  },
  {
    direct: "/workshops/public/E2E-invalid-slug",
    prefix: "/workshops/public/",
    editable: false,
    expectedStatus: 404,
  },
  { list: "/council-meetings", prefix: "/council-meetings/", editable: true },
  { list: "/council-decisions", prefix: "/council-decisions/", editable: true },
  {
    list: "/council-decisions?tab=appointments",
    prefix: "/council-decisions/appointments/",
    editable: true,
  },
  {
    list: "/council-decisions?tab=rulings",
    prefix: "/council-decisions/rulings/",
    editable: true,
  },
  { list: "/professor-capacity", prefix: "/professor-capacity/", editable: false },
] as const;

test.describe("linked detail surfaces", () => {
  test.use({ storageState: adminState });

  for (const source of sources) {
    test(`${source.direct ?? source.list} ${source.direct ? "rejects or renders a direct surface cleanly" : "links to a clean detail page"}`, async ({
      page,
      allowErrors,
    }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => {
        if (!isExpectedRscAccessCheck(error.message, page.url())) errors.push(error.message);
      });

      if (source.direct) {
        const directResponse = await page.goto(source.direct, { waitUntil: "networkidle" });
        const status = directResponse?.status();
        /* Next streams the parent layout before a dynamic segment can call
         * notFound(), so a browser navigation may have already committed a
         * 200 when the final not-found boundary arrives.  That is still a
         * fail-closed response; assert the boundary rather than mistaking the
         * transport detail for an exposed record.  Non-streaming responses
         * must retain the canonical 404. */
        expect([source.expectedStatus, 200], source.direct).toContain(status);
        if (source.expectedStatus === 200) {
          await expect(page.getByRole("main")).toBeVisible();
          expect(errors, `${source.direct}\n${errors.join("\n")}`).toEqual([]);
        } else {
          if (status === 200) {
            await expect(page.getByRole("heading", { name: "یافت نشد" })).toBeVisible();
          }
          /* A browser reports an expected document-level 404 as a failed
             resource. The status or the rendered boundary is the assertion
             for this path; in neither case may protected data appear. */
          allowErrors(/responded with a status of 404/);
        }
        return;
      }

      const listResponse = await page.goto(source.list as string, { waitUntil: "networkidle" });
      expect(listResponse?.status(), source.list).toBe(200);

      const hrefs = await page
        .locator(`a[href^="${source.prefix}"]`)
        .evaluateAll((links) =>
          links
            .map((link) => link.getAttribute("href"))
            .filter((href): href is string => href !== null),
        );
      const detail = hrefs.find(
        (href) =>
          !href.endsWith("/new") &&
          !href.includes("/edit") &&
          !href.includes("/export") &&
          !href.includes("/reports"),
      );
      expect(detail, `no detail link rendered on ${source.list}`).toBeTruthy();

      const detailResponse = await page.goto(detail as string, { waitUntil: "networkidle" });
      expect(detailResponse?.status(), detail).toBe(200);
      await expect(page.locator("#main-content")).toBeVisible();
      /* Server components may stream the shell before the record header. Wait
       * for the actual page readiness signal before running axe; otherwise a
       * transient shell snapshot can be audited as though it were the final
       * document. */
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(errors, `${detail}\n${errors.join("\n")}`).toEqual([]);

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
      expect(dimensions.width, `${detail} overflows horizontally`).toBeLessThanOrEqual(
        dimensions.viewport,
      );

      if (source.editable) {
        const edit = `${detail}/edit`;
        const editResponse = await page.goto(edit, {
          /* Editable surfaces keep prefetch activity alive; DOM readiness is
           * the availability contract, not an idle-network heuristic. */
          waitUntil: "domcontentloaded",
        });
        expect(editResponse?.status(), edit).toBe(200);
        await expect(page.locator("#main-content")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        const editAccessibility = await new AxeBuilder({ page }).analyze();
        expect(
          editAccessibility.violations,
          editAccessibility.violations
            .map((violation) => `${violation.id}: ${violation.help}`)
            .join("\n"),
        ).toEqual([]);

        const editDimensions = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        }));
        expect(editDimensions.width, `${edit} overflows horizontally`).toBeLessThanOrEqual(
          editDimensions.viewport,
        );
      }
    });
  }
});
