"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One entry in the settings rail, which knows whether it is the open one.
 *
 * The only client code in the frame. Everything else about a section — its
 * label, its icon, whether this person may see it at all — is settled on the
 * server; what cannot be is "which address is being read", because that is a
 * property of the browser's location.
 *
 * `exact` is for the profile, which lives at `/settings` itself: a prefix match
 * would mark it current on every section, since every section's path begins
 * with it.
 */
export function SettingsRailLink({
  href,
  label,
  exact,
  children,
}: {
  href: string;
  label: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-md ps-3 pe-2 text-sm transition-colors",
        current
          ? "bg-accent/60 font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {/*
       * A short bar on the inline-start edge marks the open section, rather
       * than filling the row. Kept as an element so both states can name the
       * same token; a pseudo-element would need the colour written twice.
       */}
      <span
        aria-hidden
        className={cn(
          "absolute start-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full",
          current ? "bg-primary" : "bg-transparent",
        )}
      />
      {children}
      <span className="truncate">{label}</span>
    </Link>
  );
}
