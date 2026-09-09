import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./auth";

/**
 * The one place a page or an action learns who is asking.
 *
 * Deliberately not middleware. Middleware runs before the request reaches the
 * code that will use the answer, which means the answer has to be carried —
 * usually in a header — and a header set by the application is a header a
 * browser can also set. Every page and every Server Action asks here instead,
 * so a screen that forgets to ask does not render a screen with the wrong
 * viewer; it fails to compile, because `tenantId` has nowhere to come from.
 *
 * `cache()` scopes the result to one request. A page, its layout and three
 * server components all asking "who is this" is one session read, not five.
 */
export const currentSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
