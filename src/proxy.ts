import { type NextRequest, NextResponse } from "next/server";

/**
 * The Content-Security-Policy, per request.
 *
 * This lives in the proxy rather than `next.config.ts` for one reason: a
 * static `script-src 'self'` forbids the *inline* scripts the App Router
 * cannot function without — React's streamed-segment swap (`$RC(…)`) and the
 * hydration bootstrap are `<script>` tags with no `src`. With the policy in
 * config they were blocked, and the symptom was the worst kind: every byte of
 * every page arrived, and nothing on screen ever happened. The shell rendered,
 * the spinner span forever, clicks did nothing — the browser was forbidden
 * from running the code that turns the stream into a page.
 *
 * A nonce is what lets both be true: the browser runs only the scripts this
 * server generated, because each one carries a value an attacker cannot put in
 * injected markup. Next reads the policy from the *request* headers here and
 * stamps its own scripts with the nonce automatically — that reading is the
 * whole reason this file exists.
 *
 * `'strict-dynamic'` says a script the nonce trusted may load more scripts,
 * which is what the framework's chunk loader does. `'unsafe-inline'` after it
 * is ignored by every browser that understands nonces and is the fallback for
 * the handful that do not.
 *
 * `'unsafe-eval'` is development-only: the HMR runtime evaluates source in the
 * browser, and without it every edit breaks the page until reload. It never
 * ships to production.
 */
export function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const nonce = btoa(crypto.randomUUID());

  const browserStorageOrigin = configuredBrowserStorageOrigin();
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' ${
      process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self'${browserStorageOrigin ? ` ${browserStorageOrigin}` : ""}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("x-request-id", requestId);
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return response;
}

function configuredBrowserStorageOrigin(): string | null {
  const raw = process.env.OBJECT_STORAGE_BROWSER_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const config = {
  /* Documents and Server Action posts. Static assets need no policy — they
     execute nothing — and skipping them keeps the nonce out of cacheable
     responses, where a reused nonce would be a reused permission. */
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
