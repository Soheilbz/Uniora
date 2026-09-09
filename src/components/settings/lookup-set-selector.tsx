"use client";

import { Check, FolderKanban, GraduationCap, LayoutGrid, Search, Users, Vote } from "lucide-react";
import Link from "next/link";
import { useFormatter } from "next-intl";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SetMeta {
  set: string;
  total?: number;
  retired?: number;
}

export interface LookupSelectorWords {
  selectorLabel?: string;
  setsCount?: string;
  searchPlaceholder?: string;
  emptySearch?: string;
  allSets?: string;
  groupLabels: Record<string, string>;
  setLabels: Record<string, string>;
}

export type LookupGroup = "educational" | "faculty" | "research" | "identity" | "other";

/**
 * Structural metadata only. Human-readable labels live in the message catalogues
 * so there is one translation source rather than an inline bilingual shadow copy.
 */
export const SET_METADATA: Record<string, { group: LookupGroup }> = {
  faculties: { group: "educational" },
  departments: { group: "educational" },
  fields_of_study: { group: "educational" },
  degrees: { group: "educational" },
  student_statuses: { group: "educational" },
  admission_types: { group: "educational" },
  entry_methods: { group: "educational" },
  funding_types: { group: "educational" },
  quotas: { group: "educational" },
  diploma_types: { group: "educational" },
  last_degrees: { group: "educational" },
  universities: { group: "educational" },

  academic_ranks: { group: "faculty" },
  professor_grades: { group: "faculty" },
  professor_statuses: { group: "faculty" },
  instructor_roles: { group: "faculty" },
  employment_statuses: { group: "faculty" },
  workplaces: { group: "faculty" },
  workplace_regions: { group: "faculty" },

  council_review_statuses: { group: "research" },
  attendance_statuses: { group: "research" },
  decision_report_categories: { group: "research" },
  ruling_report_categories: { group: "research" },
  worksheet_categories: { group: "research" },
  research_types: { group: "research" },
  workshop_statuses: { group: "research" },
  workshop_locations: { group: "research" },
  weekdays: { group: "research" },

  genders: { group: "identity" },
  marital_statuses: { group: "identity" },
  nationalities: { group: "identity" },
  military_statuses: { group: "identity" },
  military_status_types: { group: "identity" },
  military_letter_statuses: { group: "identity" },
  veteran_statuses: { group: "identity" },
  banks: { group: "identity" },
  payment_statuses: { group: "identity" },
  dependencies: { group: "identity" },
};

const GROUPS = [
  { key: "all", icon: LayoutGrid },
  { key: "educational", icon: GraduationCap },
  { key: "faculty", icon: Users },
  { key: "research", icon: Vote },
  { key: "identity", icon: FolderKanban },
  { key: "other", icon: FolderKanban },
];

export function LookupSetSelector({
  sets,
  open,
  t,
}: {
  sets: SetMeta[];
  open: string;
  t: LookupSelectorWords;
}) {
  const format = useFormatter();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");

  const items = useMemo(() => {
    return sets.map((s) => {
      const meta = SET_METADATA[s.set];
      return {
        ...s,
        label: t.setLabels[s.set] ?? s.set,
        group: meta?.group ?? "other",
      };
    });
  }, [sets, t]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchGroup = activeGroup === "all" || item.group === activeGroup;
      if (!matchGroup) return false;
      if (!term) return true;
      return (
        item.label.toLowerCase().includes(term) ||
        item.set.toLowerCase().includes(term) ||
        item.group.toLowerCase().includes(term)
      );
    });
  }, [items, search, activeGroup]);

  const visibleGroups = GROUPS.filter(
    (group) => group.key === "all" || filtered.some((item) => item.group === group.key),
  );

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
      {/* Top Filter Bar: Group Tabs & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            const isSelected = activeGroup === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setActiveGroup(g.key)}
                aria-pressed={isSelected}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                <span>{g.key === "all" ? t.allSets : t.groupLabels[g.key]}</span>
              </button>
            );
          })}
        </div>

        {/* Quick Search */}
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="h-8 ps-8 text-xs placeholder:text-muted-foreground/70"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>{t.selectorLabel}</span>
        <span className="font-semibold text-foreground">{format.number(sets.length)}</span>
        <span>{t.setsCount}</span>
      </div>

      {/* Lookup sets grouped as a readable directory rather than a chip cloud. */}
      <nav aria-label={t.selectorLabel} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">{t.emptySearch}</p>
        ) : (
          visibleGroups
            .filter((group) => group.key !== "all")
            .map((group) => {
              const groupItems = filtered.filter((item) => item.group === group.key);
              if (groupItems.length === 0) return null;
              return (
                <section key={group.key} className="flex flex-col gap-2">
                  <h3 className="px-1 text-xs font-bold text-foreground">
                    {t.groupLabels[group.key]}
                    <span className="ms-1 font-mono text-[10px] text-muted-foreground">
                      ({format.number(groupItems.length)})
                    </span>
                  </h3>
                  <div className="grid gap-2">
                    {groupItems.map((item) => {
                      const isCurrent = item.set === open;
                      return (
                        <Link
                          key={item.set}
                          href={`/settings/lookups?set=${encodeURIComponent(item.set)}`}
                          aria-current={isCurrent ? "page" : undefined}
                          className={cn(
                            "group flex min-h-14 items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
                            isCurrent
                              ? "border-primary/80 bg-primary/10 font-bold text-primary ring-1 ring-primary/30"
                              : "border-border/70 bg-background text-foreground hover:border-primary/40 hover:bg-primary/5",
                          )}
                        >
                          {isCurrent && <Check className="size-3.5 shrink-0 text-primary" />}
                          <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                            <span className="truncate font-semibold leading-tight">
                              {item.label}
                            </span>
                            <span
                              className="font-mono text-[10px] text-muted-foreground group-hover:text-muted-foreground"
                              dir="ltr"
                            >
                              {item.set}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
                            <span>{format.number(item.total ?? 0)}</span>
                            {(item.retired ?? 0) > 0 && (
                              <span className="rounded bg-muted px-1.5 py-0.5">
                                -{format.number(item.retired ?? 0)}
                              </span>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })
        )}
      </nav>
    </div>
  );
}
