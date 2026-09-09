import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";
import { canonicalAuthUsername } from "../../src/lib/auth-username";

export type { Page } from "@playwright/test";

/**
 * The fixture every E2E test runs through: a page that is *observed*.
 *
 * A test that only asserts what it sees on screen can pass while the browser
 * is quietly on fire — hydration failed, a chunk 404'd, the CSP refused the
 * script that would have made the page interactive. This fixture watches
 * every page and fails the test afterwards if any of that happened, unless
 * the test explicitly declared the error expected (see `allowErrors`).
 *
 * Nothing is globally suppressed: an allowlist entry is a scoped, documented
 * decision inside the one test that needs it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/*
 * Shard-aware paths.
 *
 * The suite can run as several independent groups in parallel (see
 * scripts/e2e/run.mjs), each against its own database, port and auth
 * directory. A group identifies itself through the E2E_* environment the
 * runner sets; unset means the classic single run and these fall back to the
 * original locations.
 */

/** Directory holding the session files auth.setup.ts writes. */
const authDir = process.env.E2E_AUTH_DIR ?? "e2e/.auth";

/** A storageState file for this group's sign-ins. */
export function auth(name: string): string {
  return `${authDir}/${name}`;
}

/** Fixture state written by `scripts/e2e/seed-fixtures.ts` after provisioning. */
export interface E2EState {
  tenantA: {
    slug: string;
    admin: { username: string; password: string };
    users: {
      owner: { username: string; password: string };
      clerk: { username: string; password: string };
      reader: { username: string; password: string };
      ids: { ownerId: string; clerkId: string; readerId: string };
    };
    studentId: string;
    studentNumber: string;
    studentName: string;
    meetingId: string;
    meetingNumber: string;
    proposalDecisionId: string;
    finalDecisionId: string;
    workshopId: string;
    workshopTitle: string;
  };
  tenantB: {
    slug: string;
    admin: { username: string; password: string };
    studentId: string;
    professorId: string;
    studentNumber: string;
  };
  platform: { userId: string; username: string; password: string; mfaSecret: string };
  platformSetup: { userId: string; username: string; password: string };
}

export const state: E2EState = JSON.parse(
  readFileSync(process.env.E2E_STATE_FILE ?? join(root, "e2e", ".state.json"), "utf8"),
);

interface Observed {
  consoleErrors: { text: string }[];
  pageErrors: { message: string }[];
  cspViolations: { blocked: string; directive: string }[];
  badAssets: { url: string; status: number }[];
  failedRequests: { url: string; failure: string }[];
}

/**
 * WebKit reports cancelled same-origin RSC prefetches as page errors with an
 * "access control checks" suffix. This is a browser lifecycle diagnostic, not
 * an application exception. Keep the classifier narrow: it must contain the
 * current host, either an RSC query marker or a same-origin path, and the
 * exact diagnostic suffix.
 */
export function isExpectedRscAccessCheck(message: string, pageUrl: string): boolean {
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).host;
  } catch {
    return false;
  }
  if (pageHost === "" || !message.endsWith(" due to access control checks.")) return false;
  if (message.includes(pageHost) && /[?&]_rsc=[^\s]+/.test(message)) return true;

  const path = message.slice(0, -" due to access control checks.".length).replace(/^\/+/, "");
  return path.startsWith(`${pageHost}/`);
}

/** WebKit logs a cancelled framework chunk as a console error during a
 * navigation refresh. A real missing chunk is still caught by badAssets. */
export function isExpectedCancelledStaticChunk(message: string, pageUrl: string): boolean {
  let pageOrigin = "";
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    return false;
  }
  const match = message.match(/^TypeError: Load failed \[(https?:\/\/[^\]]+)\]$/);
  if (!match) return false;
  const resourceUrl = match[1];
  if (!resourceUrl) return false;
  try {
    const resource = new URL(resourceUrl);
    return resource.origin === pageOrigin && resource.pathname.startsWith("/_next/static/chunks/");
  } catch {
    return false;
  }
}

function observe(
  page: Page,
): Observed & { allow: (pattern: RegExp) => void; assertClean: () => void } {
  const seen: Observed = {
    consoleErrors: [],
    pageErrors: [],
    cspViolations: [],
    badAssets: [],
    failedRequests: [],
  };
  const allowed: RegExp[] = [];
  let expectedDocumentAbortSeen = false;

  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      const text = location ? `${message.text()} [${location}]` : message.text();
      if (!isExpectedCancelledStaticChunk(text, page.url())) seen.consoleErrors.push({ text });
    }
  });
  page.on("pageerror", (error) => {
    const expectedRscAccessCheck = isExpectedRscAccessCheck(error.message, page.url());
    const pageHost = (() => {
      try {
        return new URL(page.url()).host;
      } catch {
        return "";
      }
    })();
    const expectedCancelledFetchError =
      (/^TypeError: Load failed$/.test(error.message) &&
        pageHost !== "" &&
        !new URL(page.url()).pathname.startsWith("/api/")) ||
      (expectedDocumentAbortSeen &&
        /^(?:NetworkError when attempting to fetch resource\.|Error in input stream)$/.test(
          error.message,
        ));
    if (expectedRscAccessCheck || expectedCancelledFetchError) return;
    seen.pageErrors.push({ message: error.message });
  });
  /* CSP refusals that the browser does not log as console errors. */
  page.on("console", (message) => {
    if (/Refused to (execute|load|apply)/.test(message.text())) {
      seen.cspViolations.push({ blocked: message.text().slice(0, 200), directive: "console" });
    }
  });
  /* Failed application assets: a 404 chunk or a 500 on framework JS. */
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/_next/") && response.status() >= 400) {
      seen.badAssets.push({ url: url.pathname, status: response.status() });
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    const url = new URL(request.url());
    /*
     * Aborts that are the browser navigating away are not failures. Firefox
     * also reports NS_BINDING_ABORTED/NS_BASE_STREAM_CLOSED for static assets
     * and RSC responses when the document is replaced. Keep this allowlist
     * deliberately narrow: only same-origin framework/static assets qualify;
     * an aborted API, RSC, upload, or application request still fails the
     * test unless it is covered by the navigation/RSC rule below.
     */
    const cancellation =
      /ABORTED|ERR_ABORTED|NS_BINDING_ABORTED|NS_BASE_STREAM_CLOSED|cancelled|canceled/i;
    const expectedRscAbort = /[?&]_rsc=/.test(request.url()) && cancellation.test(failure);
    const expectedFirefoxStaticAssetAbort =
      /NS_BINDING_ABORTED/i.test(failure) &&
      ["font", "image", "script", "stylesheet"].includes(request.resourceType()) &&
      url.origin === new URL(page.url()).origin &&
      (url.pathname.startsWith("/_next/static/") || /^\/(?:icon|favicon)\.svg$/.test(url.pathname));
    /* A document GET can be reported as a non-navigation request when a
       server-action refresh and the browser's current navigation overlap.
       It is the same lifecycle cancellation as isNavigationRequest(), not a
       failed application call. Keep the exception narrower than a generic
       aborted request: same-origin document GETs only; API, RSC, uploads and
       all cross-origin requests remain observable failures. */
    let currentUrl: URL | null = null;
    try {
      currentUrl = new URL(page.url());
    } catch {
      /* A page without a committed document has no lifecycle cancellation to classify. */
    }
    const sameOrigin = currentUrl?.origin === url.origin;
    const expectedDocumentAbort =
      sameOrigin &&
      request.method() === "GET" &&
      cancellation.test(failure) &&
      !url.pathname.startsWith("/api/");
    const expectedServerActionAbort =
      sameOrigin &&
      request.method() === "POST" &&
      !url.pathname.startsWith("/api/") &&
      cancellation.test(failure);
    const expectedSearchAbort =
      sameOrigin &&
      request.method() === "GET" &&
      url.pathname === "/api/search" &&
      cancellation.test(failure);
    if (
      (request.isNavigationRequest() ||
        expectedRscAbort ||
        expectedFirefoxStaticAssetAbort ||
        expectedDocumentAbort ||
        expectedServerActionAbort ||
        expectedSearchAbort) &&
      cancellation.test(failure)
    ) {
      if (expectedDocumentAbort || expectedServerActionAbort || expectedRscAbort) {
        /*
         * Firefox can surface the abort of a same-origin RSC response as a
         * pageerror after the replacement document has already committed:
         * `Error in input stream`. The response is the navigation lifecycle,
         * not an application failure; retain the evidence so the pageerror
         * classifier below can make the same narrow decision.
         */
        expectedDocumentAbortSeen = true;
      }
      return;
    }
    seen.failedRequests.push({ url: request.url(), failure });
  });

  return {
    ...seen,
    allow(pattern: RegExp) {
      allowed.push(pattern);
    },
    assertClean() {
      type Entry = { text?: string; message?: string; blocked?: string; url?: string };
      const filter = (list: Entry[], key: keyof Entry) =>
        list.filter((entry) => {
          const text = String(entry[key] ?? "");
          /* Firefox reports a cancelled font request as a console error when
             navigation replaces a document before the font finishes. The
             specific NS_BINDING_ABORTED code is browser lifecycle noise; a
             real font 404/500 remains a failure and is not allowlisted. */
          const cancelledFontDownload =
            /downloadable font: download failed.*status=2152398850/i.test(text);
          return !cancelledFontDownload && !allowed.some((pattern) => pattern.test(text));
        });
      const problems = [
        ...filter(seen.consoleErrors as never, "text").map(
          (e) => `console error: ${(e as { text: string }).text}`,
        ),
        ...filter(seen.pageErrors as never, "message").map(
          (e) => `uncaught exception: ${(e as { message: string }).message}`,
        ),
        ...seen.cspViolations.map((e) => `CSP violation: ${e.blocked}`),
        ...seen.badAssets.map((e) => `asset ${e.status}: ${e.url}`),
        ...seen.failedRequests.map((e) => `request failed: ${e.url} (${e.failure})`),
      ];
      expect(problems, "the browser hit errors during this test").toEqual([]);
    },
  };
}

type TestFixtures = {
  /** The observed page — replaces the bare `page` fixture everywhere. */
  page: Page;
  /** Opens an independently authenticated page that is observed like the primary page. */
  openObservedPage: (storageState?: string) => Promise<Page>;
  /**
   * Declares that this test expects console errors matching the pattern —
   * a failed sign-in *is* a failed HTTP request, and the browser logs that.
   * Scoped to the calling test only, never global.
   */
  allowErrors: (pattern: RegExp) => void;
};

const watches = new WeakMap<Page, ReturnType<typeof observe>>();

/**
 * Let the document finish its font lifecycle before the context is torn down.
 * Firefox reports a font fetch that is cancelled by page teardown as
 * NS_BINDING_ABORTED. Waiting for the browser's own FontFaceSet promise keeps
 * that lifecycle race out of the observation window without allowing real
 * 404/500/font decoding failures: those are still reported by response and
 * console observers below.
 */
async function settleDocumentFonts(page: Page) {
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
}

export const test = base.extend<TestFixtures>({
  page: async ({ page }, use) => {
    const watch = observe(page);
    watches.set(page, watch);
    await use(page);
    await settleDocumentFonts(page);
    watch.assertClean();
  },
  allowErrors: async ({ page }, use) => {
    await use((pattern) => watches.get(page)?.allow(pattern));
  },
  openObservedPage: async ({ browser }, use) => {
    const opened: Array<{
      context: Awaited<ReturnType<typeof browser.newContext>>;
      watch: ReturnType<typeof observe>;
    }> = [];

    await use(async (storageState) => {
      /* A context created from the raw `browser` fixture does not inherit the
         project's `use` block. Carry the options that make the primary page's
         contract true as well: relative URLs, Persian locale, and Tehran date
         boundaries. Without `baseURL`, `page.goto("/students")` on a secondary
         context is not even a valid navigation. */
      const context = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3021",
        locale: "fa-IR",
        timezoneId: "Asia/Tehran",
        ...(storageState ? { storageState } : {}),
      });
      const page = await context.newPage();
      const watch = observe(page);
      watches.set(page, watch);
      opened.push({ context, watch });
      return page;
    });

    let firstFailure: unknown;
    for (const { context, watch } of opened.reverse()) {
      try {
        const page = context.pages()[0];
        if (page) await settleDocumentFonts(page);
        watch.assertClean();
      } catch (cause) {
        firstFailure ??= cause;
      } finally {
        await context.close();
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
  },
});

export { expect };

/** A fresh unique suffix, so records created by one run never collide. */
export function unique(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Today's date as Tehran stores it — what the date picker must produce. */
export function tehranToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * The register's search box lives inside the filter strip, which starts
 * collapsed. Open it the way a reader does.
 */
export async function openRegisterSearch(page: Page) {
  const input = page.getByPlaceholder("نام، نام خانوادگی، شماره دانشجویی…");
  /*
   * Do not decide whether the panel is open while the document is still
   * hydrating. On a reload of an already-filtered register the server has
   * rendered the panel open, but the `hidden` ancestor can briefly report the
   * input as invisible. Clicking the toggle in that window closes the panel
   * and makes the helper wait for the opposite URL state forever.
   */
  await expect(input).toHaveAttribute("data-register-search-hydrated", "true", {
    timeout: 30_000,
  });
  if (!(await input.isVisible().catch(() => false))) {
    await page.getByRole("link", { name: "فیلترها" }).click();
    // The filter strip is URL-backed. Wait for its navigation before typing;
    // otherwise a slow tablet can let the initial `filters=1` navigation win
    // the race against the first debounced search update.
    await expect(page).toHaveURL(/(?:\?|&)filters=1(?:&|$)/, { timeout: 30_000 });
    /* The server-component navigation replaces the search input. The new
     * instance has its own hydration marker and must be ready before the
     * caller types into it. */
    await expect(input).toHaveAttribute("data-register-search-hydrated", "true", {
      timeout: 30_000,
    });
  }
  await expect(input).toBeVisible();
  return input;
}

/** Sign in through the real endpoint; the session cookie lands in the
 * context's shared jar. The sign-in *form* is exercised in auth.spec. */
export async function login(page: Page, username: string, password: string) {
  let response = await page.context().request.post("/api/auth/sign-in/username", {
    data: { username: canonicalAuthUsername(state.tenantA.slug, username), password },
  });
  /* The route is rate-limited; back off and retry once on 429. */
  for (let attempt = 0; response.status() === 429 && attempt < 3; attempt++) {
    await page.waitForTimeout(15_000);
    response = await page.context().request.post("/api/auth/sign-in/username", {
      data: { username: canonicalAuthUsername(state.tenantA.slug, username), password },
    });
  }
  if (response.status() !== 200) {
    throw new Error(`sign-in for ${username} failed: ${response.status()}`);
  }
  await page.goto("/");
  /* Hydrated: the sidebar's search trigger responds. */
  await expect(page.getByRole("button", { name: "جست‌وجو" })).toBeAttached();
}
