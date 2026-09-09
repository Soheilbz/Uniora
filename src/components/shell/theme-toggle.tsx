"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

/**
 * Light or dark, on a screen with no shell around it.
 *
 * `AppearanceControls` carries the same toggle beside the language switch in
 * the application's toolbar, but that component belongs to a signed-in page: it
 * knows the locale, it posts a Server Action to change it, and it is wrapped in
 * a tooltip provider the sign-in screen does not mount. This is the toggle
 * alone, for the one screen that renders before any of that exists.
 */
export function ThemeToggle({ label }: { label: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/*
       * Both icons rendered and one hidden by CSS, rather than picking from
       * `resolvedTheme`. On the server that value is unknown — the theme lives
       * in `localStorage` — so choosing here would render a sun, hydrate to a
       * moon, and log a mismatch on every load for anybody using dark mode.
       */}
      <Sun className="size-4 dark:hidden" aria-hidden />
      <Moon className="hidden size-4 dark:block" aria-hidden />
    </Button>
  );
}
