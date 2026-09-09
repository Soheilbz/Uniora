"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/app/actions/appearance";
import { writeLocaleCookie } from "@/lib/locale-cookie";
import { cn } from "@/lib/utils";

/**
 * The language of the page, switchable before anybody is signed in.
 *
 * The locale lives in a cookie precisely so this screen can honour it — the
 * settings screen that owns the preference sits behind sign-in, and an
 * English-speaking newcomer standing at the gate cannot reach it. The action
 * validates the value against the closed locale list before writing; this
 * control only ever sends one of the two names it renders.
 */
export function LanguageSwitch({
  current,
  label,
  fa,
  en,
}: {
  current: "fa" | "en";
  label: string;
  fa: string;
  en: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const pick = (locale: "fa" | "en") => {
    if (locale === current || pending) return;
    startTransition(async () => {
      writeLocaleCookie(locale);
      await setLocale(locale);
      /* The page's own strings, direction and font come from the server's
         render; only a fresh render speaks the new language. */
      router.refresh();
    });
  };

  return (
    <fieldset className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5">
      <legend className="sr-only">{label}</legend>
      <Languages aria-hidden className="mx-1 size-3.5 text-muted-foreground" />
      {(
        [
          ["fa", fa],
          ["en", en],
        ] as const
      ).map(([locale, name]) => (
        <button
          key={locale}
          type="button"
          onClick={() => pick(locale)}
          aria-pressed={current === locale}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/40",
            current === locale
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {name}
        </button>
      ))}
    </fieldset>
  );
}
