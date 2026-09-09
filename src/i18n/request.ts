import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { institutions } from "@/db/schema.ts";
import { readOnly, TenantUnavailableError } from "@/db/tenant.ts";
import { currentSession } from "@/lib/session.ts";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./routing";

/**
 * Which catalogue this request renders in.
 *
 * Runs on the server for every request, which is the point: the translated
 * strings are chosen and substituted before anything reaches the browser, so a
 * person downloads one language rather than two and there is no flash of the
 * wrong one while a client-side library decides.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;

  /*
   * The request config is also evaluated while Next collects the route
   * manifest during a production build.  That phase has no request, session,
   * or database by design.  Keeping the build path entirely local is
   * important for both Docker and offline release builds: a build must
   * compile an application, not impersonate a live user and query a live
   * tenant.  At runtime the branch below is never taken and the normal
   * tenant-aware locale resolution remains in force.
   */
  if (process.env.NEXT_PHASE === "phase-production-build") {
    const locale = isLocale(chosen) ? chosen : defaultLocale;
    return {
      locale,
      messages: (await import(`../messages/${locale}.json`)).default,
      timeZone: "UTC",
      now: new Date(),
    };
  }

  const session = await currentSession();
  const tenantId = (session?.user as { tenantId?: string | null } | undefined)?.tenantId;
  let timeZone = "UTC";
  let tenantLocale: unknown;
  if (tenantId) {
    try {
      const [profile] = await readOnly(tenantId, (tx) =>
        tx
          .select({ timezone: institutions.timezone, locale: institutions.locale })
          .from(institutions)
          .where(eq(institutions.tenantId, tenantId))
          .limit(1),
      );
      timeZone = profile?.timezone || "UTC";
      tenantLocale = profile?.locale;
    } catch (cause) {
      /* A Platform lifecycle change can land after the auth cookie was read but
         before this branding/preferences lookup begins. Treat an unavailable
         tenant like an unauthenticated/default-locale request; currentViewer()
         will make the same lifecycle decision on the protected route. Real DB
         failures still propagate instead of being hidden as a locale fallback. */
      if (!(cause instanceof TenantUnavailableError)) throw cause;
    }
  }
  const locale = isLocale(chosen) ? chosen : isLocale(tenantLocale) ? tenantLocale : defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone,
    now: new Date(),
  };
});
