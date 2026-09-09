import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests run in Node, not a browser.
 *
 * What is worth testing at this layer is the logic that decides *permissions* —
 * pure functions over a capability list — and none of it touches the DOM.
 * Component behaviour is verified against the running application instead,
 * because the questions that matter there (does the sidebar sit on the right in
 * a right-to-left document, is the font the one that was asked for) are answered
 * by computed style on a real page and not by a jsdom that resolves neither.
 */

/**
 * `.env.local`, loaded here rather than by the shell command that runs vitest.
 *
 * The integration suite's skip-gate reads `DATABASE_URL` from the environment;
 * loading it here means `pnpm test:integration` needs no `--env-file` plumbing
 * through whatever runner invokes it, and a checkout without the file simply
 * has an empty env — which the `describe.skipIf` gates handle as designed.
 */
function loadLocalEnv(): Record<string, string> {
  const path = new URL("./.env.local", import.meta.url);
  if (!existsSync(path)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

/**
 * Whether the configured database is actually listening.
 *
 * Presence of `DATABASE_URL` is not the same as a database behind it, and the
 * difference is the difference between a suite that skips and a suite that
 * fails red in `pnpm check`. A connection attempt answers it definitively; an
 * unreachable database means the integration project's gates stay closed this
 * run, exactly as if no configuration existed at all.
 */
async function reachable(connectionString: string | undefined): Promise<boolean> {
  if (!connectionString) return false;
  let host = "";
  let port = 5432;
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    port = Number(url.port) || 5432;
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const attempted = connect(port, host, () => {
      attempted.destroy();
      resolve(true);
    });
    attempted.setTimeout(750, () => {
      attempted.destroy();
      resolve(false);
    });
    attempted.on("error", () => resolve(false));
  });
}

const localEnv = loadLocalEnv();
/* The gates only open when the database the URL names is really listening.
   The environment wins over `.env.local` — that ordering is what lets CI,
   which has no such file, open the same gates with service-provisioned
   credentials. */
const connectionString = process.env.DATABASE_URL ?? localEnv.DATABASE_URL;
const databaseUp = await reachable(connectionString);

/*
 * An explicit integration run is a release assertion, not an optional probe.
 * Vitest treats a suite in which every describe.skipIf gate closes as success,
 * which can turn "the database was unreachable" into a false-green
 * `pnpm test:integration`. The default unit command may run without PostgreSQL;
 * the explicit integration command must fail closed.
 */
const integrationRequested = process.argv.some(
  (argument, index) =>
    argument === "--project=integration" ||
    (argument === "--project" && process.argv[index + 1] === "integration"),
);
if (integrationRequested && !databaseUp) {
  throw new Error(
    "Integration tests were requested, but DATABASE_URL is missing or its PostgreSQL endpoint is unreachable.",
  );
}

/** The DB-related variables the integration suite may need, merged from the
    file and the environment — the environment winning. When the environment
    names a database it must name it for BOTH roles: a DATABASE_URL pointing
    one way while a leftover file hands the admin role another database's
    credentials splits the suite across two clusters, and every test that
    writes through one connection and reads through the other sees a world
    that explains nothing. */
function mergeDbEnv(): Record<string, string> {
  const keys = ["DATABASE_URL", "DATABASE_ADMIN_URL", "APP_DB_PASSWORD"];
  const merged: Record<string, string> = { ...localEnv };
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) merged[key] = value;
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL === undefined) {
    delete merged.DATABASE_ADMIN_URL;
  }
  return merged;
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  /*
   * Transform/coverage cache inside the repository, beside the other caches
   * (.univ/cache). This is Vite's option — Vitest has no override of its own.
   * The default, node_modules/.vite, is also local but dies with an install;
   * here deleting `.univ/cache` is the one documented way to reset caches.
   */
  cacheDir: ".univ/cache/vitest",
  test: {
    /*
     * Two projects, because they have different prerequisites.
     *
     * `unit` runs anywhere, needs nothing, and is what `pnpm check` gates on.
     * `integration` needs a seeded PostgreSQL and is run deliberately — putting
     * it in the default run would mean a checkout with no database reports a
     * failing test suite, which trains people to ignore a red suite.
     */
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          /* Handed to the tests only when the database answered; their
             `describe.skipIf(!process.env.DATABASE_URL)` does the rest. The
             process environment wins over the file, so CI's service
             credentials take precedence over a developer's leftovers. */
          env: databaseUp ? mergeDbEnv() : {},
          /*
           * One file at a time, because they share one database.
           *
           * Vitest runs test files in parallel workers by default, which is
           * right when each is isolated and wrong here: these all read and
           * write the same seeded PostgreSQL. A suite that inserts a fixture —
           * an incomplete student for the reports, a retired vocabulary entry
           * for the lookups — makes it visible to every other file for as long
           * as it lives, and the failure lands somewhere else entirely. The
           * reports fixture broke a student-register assertion about sort
           * order, which is a genuinely hard thing to read backwards from.
           *
           * The suite takes a few seconds; a shared database is not the place
           * to buy them back.
           */
          fileParallelism: false,
        },
      },
    ],
  },
});
