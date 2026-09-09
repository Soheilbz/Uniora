"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Light and dark, following the machine unless somebody says otherwise.
 *
 * `attribute="class"` because that is what the stylesheet is written against:
 * every dark token lives under `.dark` in `globals.css`, and shadcn's own
 * `@custom-variant dark` reads the same class. Switching to a `data-` attribute
 * here would leave the tokens unreachable and the theme silently stuck on light.
 *
 * `disableTransitionOnChange` stops every colour on the page animating when the
 * theme flips. On a dense register — hundreds of rows, each with a border and a
 * background — that transition is a visible sweep down the screen rather than a
 * change, and it is slow on the machines this actually runs on.
 */
type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "theme";

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme, resolvedTheme: ResolvedTheme, disableTransition = false) {
  const root = document.documentElement;
  if (disableTransition) {
    const style = document.createElement("style");
    style.appendChild(
      document.createTextNode(
        "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}",
      ),
    );
    document.head.appendChild(style);
    window.getComputedStyle(document.body);
    window.setTimeout(() => style.remove(), 1);
  }
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.classList.toggle("light", resolvedTheme === "light");
  root.style.colorScheme = resolvedTheme;
  root.dataset.theme = theme;
}

/**
 * Local theme context for the app shell.
 *
 * The previous dependency rendered an inline <script> from inside a client
 * component. React 19/Next 16 rejects that shape during client rendering,
 * which made otherwise healthy pages fall into the global error screen. Theme
 * persistence and system-theme tracking do not require a render-time script:
 * they are safely applied after hydration here.
 */
export function ThemeProvider({ children }: { children: ReactNode; nonce?: string | undefined }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Storage can be disabled by an enterprise browser policy.
    }
    const nextResolved = nextTheme === "system" ? systemTheme() : nextTheme;
    setResolvedTheme(nextResolved);
    applyTheme(nextTheme, nextResolved, true);
  }, []);

  useEffect(() => {
    let storedTheme: Theme = "system";
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (value === "light" || value === "dark" || value === "system") storedTheme = value;
    } catch {
      // Fall back to the operating system preference.
    }
    const resolved = storedTheme === "system" ? systemTheme() : storedTheme;
    setThemeState(storedTheme);
    setResolvedTheme(resolved);
    applyTheme(storedTheme, resolved);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (storedTheme === "system") {
        const nextResolved = systemTheme();
        setResolvedTheme(nextResolved);
        applyTheme("system", nextResolved);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
