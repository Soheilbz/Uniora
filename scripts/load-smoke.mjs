import { performance } from "node:perf_hooks";

/*
 * A small, dependency-free acceptance probe for the deployment runbook.
 *
 * It deliberately speaks HTTP rather than reaching into application internals:
 * the question is whether the running instance and its reverse proxy answer a
 * realistic burst, not whether a local function is fast. Keep the default
 * paths read-only and allow an operator to supply an authenticated cookie only
 * at invocation time; credentials are never printed.
 *
 * Examples:
 *   LOAD_BASE_URL=https://univ.example.com LOAD_CONCURRENCY=40 \
 *     LOAD_REQUESTS=400 pnpm load:smoke
 *   LOAD_COOKIE='better-auth.session_token=…' LOAD_PATHS=/students,/professors \
 *     pnpm load:smoke
 *   LOAD_BASE_URLS=https://web-1.example.com,https://web-2.example.com \
 *     LOAD_COOKIE='better-auth.session_token=…' pnpm load:smoke
 *   LOAD_COOKIES='better-auth.session_token=…,...' pnpm load:smoke
 */

const baseUrls = parseOrigins(
  process.env.LOAD_BASE_URLS?.trim() ||
    process.env.LOAD_BASE_URL?.trim() ||
    "http://127.0.0.1:3020",
);
const concurrency = positiveInteger(process.env.LOAD_CONCURRENCY, 20);
const requestCount = positiveInteger(process.env.LOAD_REQUESTS, 200);
const p95Limit = optionalInteger(process.env.LOAD_P95_MS);
const allowedStatuses = new Set(
  (process.env.LOAD_ALLOWED_STATUSES || "200,204,301,302,303,307,308")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value)),
);
const paths = (
  process.env.LOAD_PATHS ||
  "/api/healthz,/students,/professors,/council-meetings,/council-decisions,/professor-capacity,/reviewer-counts"
)
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);
if (paths.length === 0) fail("LOAD_PATHS must contain at least one path.");

const singleCookie = process.env.LOAD_COOKIE?.trim();
const cookies = (process.env.LOAD_COOKIES ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (singleCookie && cookies.length > 0) {
  fail("Use LOAD_COOKIE or LOAD_COOKIES, not both.");
}
const requestCookies = cookies.length > 0 ? cookies : singleCookie ? [singleCookie] : [];
const results = [];
let next = 0;

async function worker() {
  while (true) {
    const index = next++;
    if (index >= requestCount) return;
    const path = paths[index % paths.length];
    const started = performance.now();
    try {
      const origin = baseUrls[index % baseUrls.length];
      const requestCookie = requestCookies.length
        ? requestCookies[index % requestCookies.length]
        : undefined;
      const response = await fetch(new URL(path, origin), {
        headers: requestCookie ? { cookie: requestCookie } : undefined,
        redirect: "manual",
      });
      await response.arrayBuffer();
      results.push({
        origin: origin.origin,
        path,
        status: response.status,
        ms: performance.now() - started,
      });
    } catch (error) {
      results.push({
        origin: origin.origin,
        path,
        status: 0,
        ms: performance.now() - started,
        error: String(error),
      });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));

const failures = results.filter(
  (result) => result.status === 0 || !allowedStatuses.has(result.status),
);
for (const path of paths) {
  const rows = results.filter((result) => result.path === path).sort((a, b) => a.ms - b.ms);
  if (rows.length === 0) continue;
  const percentile = (ratio) => rows[Math.min(rows.length - 1, Math.floor(rows.length * ratio))].ms;
  console.log(
    JSON.stringify({
      path,
      count: rows.length,
      statuses: [...new Set(rows.map((row) => row.status))],
      p50Ms: Math.round(percentile(0.5)),
      p95Ms: Math.round(percentile(0.95)),
      maxMs: Math.round(rows.at(-1).ms),
    }),
  );
}

const overall = results.map((result) => result.ms).sort((a, b) => a - b);
const overallP95 = overall[Math.min(overall.length - 1, Math.floor(overall.length * 0.95))];
const originStats = baseUrls.map((origin) => {
  const rows = results
    .filter((result) => result.origin === origin.origin)
    .sort((a, b) => a.ms - b.ms);
  if (rows.length === 0) {
    return { origin: origin.origin, count: 0, statuses: [] };
  }
  const percentile = (ratio) => rows[Math.min(rows.length - 1, Math.floor(rows.length * ratio))].ms;
  return {
    origin: origin.origin,
    count: rows.length,
    statuses: [...new Set(rows.map((row) => row.status))],
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    maxMs: Math.round(rows.at(-1).ms),
  };
});
console.log(
  JSON.stringify({
    baseUrls: baseUrls.map((origin) => origin.origin),
    origins: originStats,
    requests: results.length,
    concurrency: Math.min(concurrency, requestCount),
    failed: failures.length,
    overallP95Ms: Math.round(overallP95),
  }),
);

if (failures.length > 0) {
  console.error(
    `load smoke failed: ${failures.length} request(s) returned an unexpected status or errored`,
  );
  process.exitCode = 1;
}
if (p95Limit !== undefined && overallP95 > p95Limit) {
  console.error(`load smoke failed: overall p95 exceeded ${p95Limit}ms`);
  process.exitCode = 1;
}

function positiveInteger(raw, fallback) {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1)
    fail("load counts and concurrency must be positive integers.");
  return value;
}

function optionalInteger(raw) {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) fail("LOAD_P95_MS must be a positive integer.");
  return value;
}

function parseOrigins(raw) {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) fail("LOAD_BASE_URLS must contain at least one URL.");

  try {
    const origins = values.map((value) => {
      const origin = new URL(value);
      if (
        !/^https?:$/.test(origin.protocol) ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      ) {
        throw new Error("not a bare http(s) origin");
      }
      return origin;
    });
    return [...new Map(origins.map((origin) => [origin.origin, origin])).values()];
  } catch {
    fail("LOAD_BASE_URLS must contain absolute http(s) origins without paths.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
