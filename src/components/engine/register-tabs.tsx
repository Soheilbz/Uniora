import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A strip of registers sharing one screen.
 *
 * Links, not a client `Tabs` component, and that is the whole design of it:
 * which tab is open is part of the address, so «انتخاب استاد راهنماهایی که شورا
 * تعیین کرده» is something an office can bookmark and send. A client tab strip
 * would keep that in React state, where the back button cannot reach it and a
 * reload loses it.
 *
 * ── Each link drops the rest of the query ───────────────────────────────────
 *
 * The three tabs are three different tables. Carrying `?field=biotechnology`
 * across would apply a filter to a list of rulings that has no such column, and
 * page eleven of one register is not page eleven of another — so the href for a
 * tab is the bare tab, and the register behind it starts unnarrowed.
 */

export interface RegisterTab {
  key: string;
  label: string;
  href: string;
  /** Already in the reader's numerals — the strip does no formatting. */
  count: string;
  active: boolean;
}

export function RegisterTabs({ tabs, countLabel }: { tabs: RegisterTab[]; countLabel: string }) {
  return (
    /*
     * `role="tablist"` is deliberately *not* used. These are links that navigate
     * to a new document, not panels swapped in place — announcing them as tabs
     * would promise a screen-reader user that arrow keys move between them and
     * that the content is already there. A named navigation is what they are.
     */
    <nav
      data-print-hide
      aria-label={countLabel}
      className="flex w-full max-w-full flex-wrap rounded-lg border border-border/80 bg-muted/45 p-1 shadow-2xs dark:border-sidebar-border/90 dark:bg-sidebar"
    >
      <ul className="flex min-w-0 w-full flex-wrap items-center gap-0.5">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "inline-flex min-w-0 max-w-full items-center justify-center gap-2 rounded-md border border-transparent px-3 py-1.5 text-sm text-center whitespace-normal leading-5 outline-none transition-colors",
                "hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-sidebar-accent/80 dark:hover:text-sidebar-accent-foreground dark:focus-visible:ring-sidebar-ring/60",
                tab.active
                  ? "border-primary/80 bg-primary font-medium text-primary-foreground shadow-2xs dark:border-sidebar-primary dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                  : "text-foreground/70 dark:text-sidebar-foreground/75",
              )}
            >
              {tab.label}
              {/*
               * The count sits on the tab, because a tab labelled «احکام» tells
               * nobody whether it is worth opening. `numeric` so the figures are
               * in the reader's own numerals and do not reflow as they change.
               */}
              <span
                className={cn(
                  "numeric min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] tabular-nums",
                  tab.active
                    ? "bg-primary-foreground text-primary dark:bg-sidebar-primary dark:text-sidebar-primary-foreground"
                    : "bg-background/80 text-foreground/70 dark:bg-sidebar-accent dark:text-sidebar-foreground/80",
                )}
              >
                {tab.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The page body under the strip, so every tab has the same rhythm. */
export function TabPanel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
