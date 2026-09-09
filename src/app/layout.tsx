import "@fontsource-variable/vazirmatn";
import "@fontsource/noto-nastaliq-urdu/400.css";
import "@fontsource/noto-nastaliq-urdu/600.css";
import "@fontsource/noto-nastaliq-urdu/700.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { DirectionProvider } from "@/components/ui/direction";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clientMessages } from "@/i18n/client-messages.ts";
import { directionOf, isLocale } from "@/i18n/routing";
import { readAppearance } from "@/lib/appearance.ts";
import "./globals.css";

/*
 * The document shell reads request cookies/headers and the locale resolver
 * may read the current session and tenant profile.  Every route below this
 * boundary is therefore request-scoped; allowing Next to try static
 * collection here makes a production build depend on a live DATABASE_URL.
 * Keep compilation and runtime separate: release images build without
 * credentials, while the live request still gets the real viewer/tenant
 * context.
 */
export const dynamic = "force-dynamic";

/**
 * The document, and the three things on it that decide whether Persian reads
 * correctly at all.
 *
 * `lang` and `dir` are set on the server from the viewer's own locale, never
 * patched on afterwards by a client effect: an RTL layout applied after first
 * paint is a visible reflow on every navigation, and on an office machine it is
 * the first thing anybody complains about.
 *
 * `DirectionProvider` is the other half, and it is not a duplicate of `dir`.
 * The HTML attribute tells the browser how to lay text out; the provider tells
 * Base UI's primitives which way is "forward" — which side a dropdown opens
 * towards, which arrow key moves to the next item, which edge a sheet slides in
 * from. Without it every menu opens on the wrong side while the text around it
 * reads correctly, which is worse than being uniformly wrong.
 *
 * The font is installed rather than fetched. shadcn's own guide reaches for
 * Google Fonts; that is the wrong call for a deployment that runs on a
 * university's own network — a stylesheet request to a third party is a
 * dependency on something the institution does not control and may not be able
 * to reach at all.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("name"), template: `%s · ${t("shortName")}` },
    description: t("name"),
    // A registry is not for search engines. Belt-and-braces beside the fact
    // that it is behind authentication and usually on a private network.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Follows the operating system until somebody chooses otherwise. Offices run
  // machines in both, and a registry that ignores the choice is one somebody
  // squints at all afternoon.
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const appearance = await readAppearance();
  const resolved = isLocale(locale) ? locale : "fa";
  const direction = directionOf(resolved);
  /*
   * The content-security nonce `proxy.ts` minted for this response.
   *
   * Read from the request headers rather than regenerated: the value Next
   * stamps onto its own script tags is the one the policy in the header names,
   * and anything that writes an inline script — next-themes is the one — must
   * carry the same value or the browser refuses it.
   */
  const nonceHeader = (await headers()).get("x-nonce");
  const nonce = nonceHeader === null ? undefined : nonceHeader;

  return (
    /*
     * The display preferences ride on the document element, written by the
     * server on the first byte.
     *
     * Not by a client effect: a density or text size applied after first paint
     * is a visible reflow on every navigation, and it is the first thing an
     * operator complains about on an office machine. `--font-scale` is a number
     * from a closed list — see `appearance.ts` — so it is safe in a `style`.
     */
    <html
      lang={resolved}
      dir={direction}
      /* Keep a concrete theme class in the first document as well as after
       * the client preference effect runs.  Without this, a slow hydration
       * window leaves the page with neither class, which makes the document's
       * theme state observably indeterminate to the browser and to assistive
       * tooling.  The provider replaces it with the resolved system choice. */
      className="light"
      data-brand={appearance.brand}
      data-density={appearance.density}
      style={{ "--font-scale": appearance.fontScale } as React.CSSProperties}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <ThemeProvider {...(nonce !== undefined ? { nonce } : {})}>
          <DirectionProvider direction={direction}>
            {/*
             * Only what a client component genuinely needs crosses to the
             * browser — see `clientMessages`, which is where the list lives and
             * where the reasoning is.
             *
             * This comment stood here over `messages={messages}` for a while,
             * describing an intention nothing implemented: the whole 95 KB
             * catalogue went into the flight payload of every page, including
             * the two largest namespaces in it, neither of which has a client
             * reader anywhere.
             */}
            <NextIntlClientProvider locale={resolved} messages={clientMessages(messages)}>
              <TooltipProvider>{children}</TooltipProvider>
              {/*
               * Toasts are the only thing here allowed to speak without being
               * asked, so they stay scarce: a save that worked, a save that did
               * not. Anything a person must act on belongs on the page, where it
               * survives being looked away from.
               */}
              <Toaster position="bottom-center" richColors closeButton />
            </NextIntlClientProvider>
          </DirectionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
