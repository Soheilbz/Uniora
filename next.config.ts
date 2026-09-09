import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/*
 * The version, inlined at build time.
 *
 * The sign-in screen prints it at the foot — support's first question is
 * «which version are you on», and that screen is the one page everybody can
 * reach. Read from package.json here rather than asked for in the
 * environment: an unset variable printed «—» for the variable's whole life,
 * which is a footer that answers nothing.
 */
const APP_VERSION = `v${
  (
    JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      version: string;
    }
  ).version
}`;

/**
 * The hosted registry, configured for a building full of people.
 *
 * Two decisions here are load-bearing and both are about what this application
 * is: one deployment serving several universities, with a couple of thousand
 * people signed in at once, behind a load balancer.
 */
const configuredDevOrigins = [
  process.env.UNIV_PUBLIC_ORIGIN,
  ...(process.env.TRUSTED_ORIGINS ?? "").split(","),
  ...(process.env.DEV_ALLOWED_ORIGINS ?? "").split(","),
]
  .flatMap((origin) => (typeof origin === "string" ? [origin.trim()] : []))
  .filter(Boolean)
  .flatMap((origin) => {
    try {
      return [new URL(origin).hostname];
    } catch {
      /* Also accept an explicitly supplied hostname for LAN development. */
      return [origin.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? ""];
    }
  });

const config: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },

  // These AI-agent instruction files are not part of the application source.
  // Keep the repository focused on the product and its own documentation.
  agentRules: false,

  /*
   * Allow development access from the local network for mobile testing and
   * multi-device inspection without HMR chunk blocking. Read from the
   * environment rather than hard-coded: a specific machine's LAN address in a
   * committed config breaks silently the day that address changes, and says
   * nothing to the next person about where it came from. Set
   * `DEV_ALLOWED_ORIGINS=10.98.0.7,192.168.1.20` in `.env.local` when needed.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost", ...configuredDevOrigins],

  /*
   * A self-contained server, because there is no platform underneath this.
   *
   * `standalone` traces the exact files the server needs and emits a Node
   * process that runs behind nginx. Without it the image carries the whole
   * `node_modules` and the deployment is slower for no reason. This is the
   * shape every self-hosted Next.js deployment converges on.
   *
   * The deployment entry point is `.next/standalone/server.js` by default —
   * `pnpm start` (`next start`) does not serve from the standalone bundle, and
   * is the development machine's convenience, not the deployment story. A
   * build may set `NEXT_DIST_DIR` to an isolated directory when another build
   * or an antivirus/indexer holds the default artifact; ordinary deploys keep
   * the documented `.next` path. See README.
   */
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",

  /*
   * Cache Components stays OFF, deliberately, and it is not an oversight.
   *
   * Next 16 can cache the render of a component tree. The failure that produces
   * in a multi-tenant application is the worst one available: a cached fragment
   * that closed over a request-scoped value — a session, a tenant id — without
   * that value being part of the cache key, served afterwards to somebody from a
   * different university. It is a documented, commonly-hit pitfall, not a
   * theoretical one.
   *
   * The benefit it would buy here is close to nothing. This is a back-office
   * registry: nearly every screen is a filtered, paginated, permission-scoped
   * table that differs per viewer and changes as the office types. There is
   * almost no shared output to reuse.
   *
   * So: off. If a genuinely shared, tenant-independent surface ever appears, it
   * gets caching explicitly, with the tenant in the key, and a test proving two
   * tenants see different bytes.
   */
  cacheComponents: false,

  // The registry holds national IDs and bank accounts. Nothing about the
  // framework should be advertised to somebody probing the deployment.
  poweredByHeader: false,

  /*
   * Every response the office reads is per-user; none of it may be held by an
   * intermediate proxy. Set here rather than per-route so a new page cannot
   * forget — the login and asset paths are the deliberate exceptions and set
   * their own headers.
   */
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
          /*
           * The Content-Security-Policy is NOT here, and that is load-bearing.
           *
           * A static policy cannot carry a per-response nonce, and without a
           * nonce `script-src 'self'` forbids the App Router's own inline
           * scripts — the streamed-segment swap and the hydration bootstrap.
           * The page arrives complete and nothing on it ever runs: shell
           * rendered, spinner forever, clicks dead. The policy lives in
           * `src/proxy.ts` — Next 16's middleware entry — which mints a nonce
           * per response that Next stamps onto its own scripts automatically.
           */
        ],
      },
    ];
  },

  experimental: {
    /*
     * Use the compiler API instead of asking a child `tsc --showConfig`
     * process to stream JSON through a pipe. The CLI path is needlessly
     * fragile in restricted runners and container supervisors where a child
     * process can exit successfully without its piped stdout being delivered;
     * that makes Next report an empty, unparsable TypeScript configuration.
     * TypeScript's API is local, deterministic, and still performs the same
     * build-time type validation.
     */
    useTypeScriptCli: false,

    /*
     * Server Actions are a public endpoint, whatever they look like in the
     * source. A body limit belongs here for the same reason `body-limits.ts`
     * existed in the previous server: an unbounded action is a way to spend a
     * shared machine's memory from a browser.
     */
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(config);
