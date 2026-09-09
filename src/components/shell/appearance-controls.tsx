"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/app/actions/appearance";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { writeLocaleCookie } from "@/lib/locale-cookie";

/**
 * The two preferences that belong to a person rather than to a page.
 *
 * ── Why they behave differently ─────────────────────────────────────────────
 *
 * The theme is a class on `<html>` and changes nothing the server rendered, so
 * it flips in the browser instantly. The language decides which catalogue the
 * *server* substituted, so changing it is a cookie and a re-render — a client
 * i18n toggle would mean shipping both languages to every reader and a visible
 * flash of the wrong one on load.
 */
export function AppearanceControls({
  locale,
  themeLabel,
  localeLabel,
}: {
  locale: string;
  themeLabel: string;
  localeLabel: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const next = locale === "fa" ? "en" : "fa";

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={themeLabel}
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {/*
               * Both icons are rendered and one is hidden by CSS, rather than
               * picking one from `resolvedTheme`. On the server that value is
               * unknown — the theme lives in `localStorage` — so choosing here
               * would render a sun, hydrate to a moon, and log a mismatch on
               * every load for anybody using dark mode.
               */}
              <Sun className="size-4 dark:hidden" aria-hidden />
              <Moon className="hidden size-4 dark:block" aria-hidden />
            </Button>
          }
        />
        <TooltipContent>{themeLabel}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={localeLabel}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  writeLocaleCookie(next as "fa" | "en");
                  await setLocale(next);
                  router.refresh();
                })
              }
            >
              <Languages className="size-4" aria-hidden />
            </Button>
          }
        />
        <TooltipContent>{localeLabel}</TooltipContent>
      </Tooltip>
    </>
  );
}
