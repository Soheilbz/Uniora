import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { findFreePort } from "./scripts/runtime-port.ts";

/*
 * Scratch space inside the repository, before Playwright resolves anything.
 *
 * Two locations are pinned here rather than left to their defaults outside
 * the project:
 *
 *   PLAYWRIGHT_BROWSERS_PATH — browser binaries are kept inside the project
 *     cache so Linux CI/developer installs are disposable with `.univ/cache`
 *     instead of leaking browser revisions into a machine-wide cache.
 *
 *   TMPDIR/TEMP/TMP — Playwright compiles test files into a transform cache
 *     and gives every Chromium context a scratch profile under the OS temp
 *     directory; killed runs leave those profiles behind there. Pointed at
 *     `.univ/runtime/tmp` they live and die with the project instead. This
 *     only re-tempories this suite's own processes (the config process, the
 *     workers it spawns, and the webServer child) — the machine-wide temp
 *     area is untouched for everything else.
 */
const root = dirname(fileURLToPath(import.meta.url));
const e2ePort = process.env.E2E_PORT ?? String(await findFreePort({ preferred: 3021 }));
process.env.E2E_PORT ??= e2ePort;
process.env.E2E_BASE_URL ??= `http://127.0.0.1:${e2ePort}`;
const runtimeTmp = join(root, ".univ", "runtime", "tmp");
mkdirSync(runtimeTmp, { recursive: true });
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(root, ".univ", "cache", "ms-playwright");
/* Escape hatch for debugging a suspected temp-directory interaction:
   UNIV_SYSTEM_TEMP=1 puts everything back on the OS temp area for one run. */
if (process.env.UNIV_SYSTEM_TEMP !== "1") {
  process.env.TMPDIR = runtimeTmp;
  process.env.TEMP = runtimeTmp;
  process.env.TMP = runtimeTmp;
}

/**
 * End-to-end tests: the real application, the real database, the real browser.
 *
 * The server under test is the production standalone build (`scripts/e2e` in
 * package.json builds first), pointed at a database that `provision.mjs`
 * destroys and rebuilds before every run — never the developer's data. One
 * worker, because several of these tests count rows in shared registers and
 * two tests mutating the same register concurrently is a flake factory, not a
 * test suite.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  /* One worker: deterministic state beats wall-clock here. Parallelism comes
     from the shard runner, which gives each group its own database/server. */
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  /* The shard runner owns cleanup for isolated artifact directories. */
  preserveOutput: process.env.E2E_EXTERNAL_SERVER === "1" ? "always" : "failures-only",
  /* Per-shard: Playwright also stages internal scratch under this directory,
     and two concurrent groups writing `.playwright-artifacts-*` beside each
     other corrupt one another's traces. The runner names one per group;
     unset means the classic single run. */
  outputDir: process.env.E2E_ARTIFACTS_DIR ?? join(root, "e2e", ".artifacts"),
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fa-IR",
    timezoneId: "Asia/Tehran",
  },
  ...(process.env.E2E_EXTERNAL_SERVER === "1"
    ? {}
    : {
        webServer: {
          command: "node scripts/e2e/serve.mjs",
          url: `${process.env.E2E_BASE_URL}/api/healthz`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "ignore" as const,
          stderr: "pipe" as const,
        },
      }),
  projects: [
    {
      name: "setup",
      testMatch: "**/*.setup.ts",
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      dependencies: ["setup"],
      // Playwright PDF generation is Chromium-only; the remaining journeys are
      // cross-engine and still exercise print-entry/navigation surfaces.
      testIgnore: ["**/print-output.spec.ts"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      dependencies: ["setup"],
      testIgnore: ["**/print-output.spec.ts"],
    },
  ],
});
