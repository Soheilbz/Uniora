"use client";

import { Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * Settle the assets whose metrics can change pagination.
 *
 * A print dialog can be opened while a self-hosted webfont is still loading.
 * That is especially visible with Nastaliq: the fallback and the final face do
 * not share line metrics, so a signature or resolution can jump to another
 * page between preview and paper. Crests can move the header for the same
 * reason. Both manual and automatic printing therefore use this one gate.
 */
async function waitForPrintAssets() {
  await document.fonts.ready;

  await Promise.all(
    Array.from(document.images).map(async (image) => {
      if (image.complete) {
        try {
          await image.decode();
        } catch {
          // A failed decorative crest must not make printing impossible.
        }
        return;
      }

      await new Promise<void>((resolve) => {
        const done = () => resolve();
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
      });
    }),
  );

  // Give layout two frames to settle after font/image metrics become final.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * The print control.
 *
 * A tiny client island, and the only client code on a record page. Printing
 * needs `window.print()`; nothing else on that screen needs a browser at all, so
 * the boundary is drawn around this button rather than around the page.
 *
 * A real `button`, not a link: it performs an action in place and goes nowhere,
 * so there is no address to middle-click and nothing for a new tab to show.
 */
export function PrintButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => void waitForPrintAssets().then(() => window.print())}
    >
      <Printer className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

/**
 * Opens the print dialog once, on arrival.
 *
 * These pages are reached by a link that says «چاپ»; arriving at one and having
 * to press print again puts a step back in front of the thing that was asked
 * for. Once only — a re-render must not reopen a dialog the reader dismissed —
 * and only after fonts, images and their final line metrics have settled.
 *
 * The whole document is server-rendered, so there is no half-loaded table to
 * guard against here: by the time this mounts, every row is already in the DOM.
 */
export function AutoPrint() {
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    let cancelled = false;

    const openWhenSettled = async () => {
      await waitForPrintAssets();
      /* Firefox keeps window.print() modal on automated and some embedded
       * contexts. Opening it during mount blocks the document from settling
       * and prevents keyboard/screen-reader inspection. The explicit print
       * button remains available, so Firefox keeps the same capability without
       * making the page unusable on arrival. */
      if (!cancelled && !/Firefox\//.test(navigator.userAgent)) window.print();
    };

    void openWhenSettled();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
