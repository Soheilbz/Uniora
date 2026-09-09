"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Signing out, on the server.
 *
 * A Server Action rather than the client's `authClient.signOut()`, because the
 * control that calls it lives in the sidebar footer — a client component the
 * shell renders — and a Server Action is the one kind of function that can cross
 * that boundary.
 *
 * Two details here are load-bearing, and skipping either one leaves somebody
 * signed out in the database but signed in on the screen:
 *
 *  - `returnHeaders: true` — Better Auth ends a session by answering with
 *    `Set-Cookie` headers that clear the session token. Called without
 *    `returnHeaders`, those headers are dropped and the browser keeps the
 *    authentication cookie, so `/sign-in` can still treat the visitor as signed
 *    in after the redirect.
 *
 *  - `revalidatePath("/", "layout")` before the redirect. Every Server
 *    Component render already made is still in the client router's cache:
 *    without the revalidation, pressing Back redraws the signed-in shell from
 *    memory for somebody who is no longer signed in. On a shared office
 *    machine that is the entire point of signing out.
 */
export async function signOut() {
  const requestHeaders = await headers();
  const { headers: responseHeaders } = await auth.api.signOut({
    headers: requestHeaders,
    returnHeaders: true,
  });

  const store = await cookies();
  for (const cookie of responseHeaders.getSetCookie()) {
    const pair: string | undefined = cookie.split(";")[0];
    if (pair === undefined) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    /* These arrive as expiry instructions; replaying them through the cookie
       store is what actually removes each one from the browser. */
    const expired = /max-age=0|expires=thu, 01 jan 1970/i.test(cookie);
    store.set(
      name,
      value,
      expired
        ? { path: "/", maxAge: 0 }
        : {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          },
    );
  }

  revalidatePath("/", "layout");
  redirect("/sign-in");
}
