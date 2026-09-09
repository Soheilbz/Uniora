"use client";

import type { LucideIcon } from "lucide-react";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string | null | undefined;
  href: string;
}

interface SearchResultGroupProps {
  heading: string;
  countLabel: string;
  items: SearchResultItem[];
  icon: LucideIcon;
  onSelect: (href: string) => void;
  tone: "primary" | "info" | "warning";
  layout?: "grid" | "list";
}

const toneClasses = {
  primary: {
    icon: "bg-primary/15 text-primary",
    iconText: "text-primary",
    badge: "bg-primary/10 text-primary",
    item: "hover:border-primary/30 hover:bg-primary/5",
  },
  info: {
    icon: "bg-info/15 text-info",
    iconText: "text-info",
    badge: "bg-info/10 text-info",
    item: "hover:border-info/30 hover:bg-info/5",
  },
  warning: {
    icon: "bg-warning/15 text-warning",
    iconText: "text-warning",
    badge: "bg-warning/10 text-warning",
    item: "hover:border-warning/30 hover:bg-warning/5",
  },
} as const;

export function GlobalSearchResultGroup({
  heading,
  countLabel,
  items,
  icon: Icon,
  onSelect,
  tone,
  layout = "grid",
}: SearchResultGroupProps) {
  if (items.length === 0) return null;
  const classes = toneClasses[tone];
  return (
    <CommandGroup
      heading={
        <div className="flex items-center justify-between px-1 py-1 text-xs font-bold text-foreground">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("size-4", classes.iconText)} aria-hidden />
            <span>{heading}</span>
          </div>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", classes.badge)}>
            {countLabel}
          </span>
        </div>
      }
      className="mb-2"
    >
      <div
        className={cn(
          "gap-1.5 pt-1",
          layout === "grid" ? "grid grid-cols-1 sm:grid-cols-2" : "flex flex-col",
        )}
      >
        {items.map((item) => (
          <CommandItem
            key={item.id}
            value={item.title}
            onSelect={() => onSelect(item.href)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border border-transparent p-2.5 transition-all",
              classes.item,
            )}
          >
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg font-bold",
                classes.icon,
              )}
            >
              <Icon className="size-4.5" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-bold text-foreground">{item.title}</span>
              {item.subtitle && (
                <span className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {item.subtitle}
                </span>
              )}
            </div>
          </CommandItem>
        ))}
      </div>
    </CommandGroup>
  );
}
