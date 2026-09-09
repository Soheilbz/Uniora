"use client";

import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowDown,
  ArrowUp,
  Compass,
  CornerDownLeft,
  FileText,
  GraduationCap,
  Landmark,
  Loader2,
  Presentation,
  Search,
  UserCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlobalSearchResultGroup } from "@/components/global-search-result-group";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";
import { cn } from "@/lib/utils";
import type { GlobalSearchResults } from "@/modules/search/service.ts";

export interface SearchDestination {
  key: string;
  label: string;
  href: string;
}

export interface SearchSection {
  key: string;
  heading: string | null;
  items: SearchDestination[];
}

function emptySearchResults(): GlobalSearchResults {
  return { students: [], professors: [], councilMeetings: [], councilDecisions: [], workshops: [] };
}

export function GlobalSearch({ sections }: { sections: SearchSection[] }) {
  const t = useTranslations("search");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shortcutReady, setShortcutReady] = useState(false);
  const [query, setQuery] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [dbResults, setDbResults] = useState<GlobalSearchResults>({
    students: [],
    professors: [],
    councilMeetings: [],
    councilDecisions: [],
    workshops: [],
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const code = event.code.toLowerCase();
      const isK = key === "k" || key === "keyk" || code === "keyk";
      if (!isK || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((previous) => !previous);
    };
    document.addEventListener("keydown", onKeyDown);
    setShortcutReady(true);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  // Debounced, abortable HTTP search. A new keystroke cancels the previous
  // request instead of merely discarding an already-running Server Action.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    setFailed(false);
    const exactPage = sections
      .flatMap((section) => section.items)
      .some((item) => item.label.toLowerCase() === trimmed.toLowerCase());
    if (trimmed.length < 2 || exactPage) {
      setIsPending(false);
      setDbResults(emptySearchResults());
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsPending(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("search request failed");
        setDbResults((await response.json()) as GlobalSearchResults);
      } catch (_error) {
        if (controller.signal.aborted) return;
        setDbResults(emptySearchResults());
        setFailed(true);
      } finally {
        if (!controller.signal.aborted) setIsPending(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, sections]);

  const visibleSections = useMemo(
    () => sections.filter((section) => section.items.length > 0),
    [sections],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const exactDestination = useMemo(
    () =>
      normalizedQuery === ""
        ? null
        : (sections
            .flatMap((section) => section.items)
            .find((item) => item.label.toLowerCase() === normalizedQuery) ?? null),
    [normalizedQuery, sections],
  );

  const hasDbResults =
    dbResults.students.length > 0 ||
    dbResults.professors.length > 0 ||
    dbResults.councilMeetings.length > 0 ||
    dbResults.councilDecisions.length > 0 ||
    dbResults.workshops.length > 0;

  const totalDbResultsCount =
    dbResults.students.length +
    dbResults.professors.length +
    dbResults.councilMeetings.length +
    dbResults.councilDecisions.length +
    dbResults.workshops.length;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        data-search-shortcut-ready={shortcutReady ? "true" : undefined}
        aria-keyshortcuts="Control+K Meta+K"
        aria-label={t("placeholder")}
        className={cn(
          "flex h-9 w-full min-w-0 max-w-sm items-center gap-2.5 rounded-xl",
          "border border-border/70 bg-muted/40 px-3 text-start text-xs font-normal text-muted-foreground",
          "shadow-2xs transition-all hover:border-primary/40 hover:bg-muted/80 hover:text-foreground",
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t("placeholder")}</span>
        <Kbd
          dir="ltr"
          className="hidden h-5 shrink-0 items-center rounded-md border border-border/70 bg-background/80 px-1.5 font-sans text-[10px] font-medium text-muted-foreground shadow-2xs lg:inline-flex"
        >
          {t("shortcut")}
        </Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        title={t("title")}
        description={t("description")}
      >
        <Command shouldFilter={false} loop className="bg-popover flex flex-col">
          {/* Top Search Input Bar */}
          <div className="relative flex items-center border-b border-border/70 px-4 py-3.5 bg-muted/20">
            <Search className="size-5 shrink-0 text-muted-foreground me-3" aria-hidden />
            <CommandPrimitive.Input
              value={query}
              maxLength={MAX_SEARCH_LENGTH}
              aria-label={t("queryPlaceholder")}
              aria-busy={isPending}
              onValueChange={setQuery}
              placeholder={t("queryPlaceholder")}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-hidden font-medium"
            />
            <div className="flex items-center gap-2 ms-2">
              {isPending && (
                <Loader2 className="size-4.5 animate-spin text-primary shrink-0" aria-hidden />
              )}
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("clear")}
                >
                  <X className="size-4" />
                </button>
              )}
              <Kbd
                dir="ltr"
                className="hidden sm:inline-flex h-5 items-center rounded border border-border/70 bg-background px-1.5 font-sans text-[10px] text-muted-foreground"
              >
                Esc
              </Kbd>
            </div>
          </div>

          {/* Results List */}
          <CommandList className="max-h-[60vh] overflow-y-auto p-2 scroll-py-2">
            {!isPending && failed && (
              <div
                role="alert"
                className="py-8 flex flex-col items-center justify-center gap-2 text-center text-sm text-destructive"
              >
                <Search className="size-8 text-muted-foreground/40" />
                <span>{t("searchFailed")}</span>
              </div>
            )}
            {!isPending &&
              !failed &&
              !exactDestination &&
              !hasDbResults &&
              query.trim().length >= 2 && (
                <CommandEmpty className="py-12 flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <Search className="size-8 text-muted-foreground/40" />
                  <span>{t("noResultsFor", { query })}</span>
                </CommandEmpty>
              )}

            {!exactDestination && (
              <>
                <GlobalSearchResultGroup
                  heading={t("students")}
                  countLabel={t("matchCount", { count: dbResults.students.length })}
                  items={dbResults.students}
                  icon={GraduationCap}
                  onSelect={go}
                  tone="primary"
                />
                <GlobalSearchResultGroup
                  heading={t("professors")}
                  countLabel={t("matchCount", { count: dbResults.professors.length })}
                  items={dbResults.professors}
                  icon={UserCheck}
                  onSelect={go}
                  tone="primary"
                />
                <GlobalSearchResultGroup
                  heading={t("councilDecisions")}
                  countLabel={t("matchCount", { count: dbResults.councilDecisions.length })}
                  items={dbResults.councilDecisions}
                  icon={FileText}
                  onSelect={go}
                  tone="warning"
                  layout="list"
                />
                <GlobalSearchResultGroup
                  heading={t("councilMeetings")}
                  countLabel={t("matchCount", { count: dbResults.councilMeetings.length })}
                  items={dbResults.councilMeetings}
                  icon={Landmark}
                  onSelect={go}
                  tone="info"
                />
                <GlobalSearchResultGroup
                  heading={t("workshops")}
                  countLabel={t("matchCount", { count: dbResults.workshops.length })}
                  items={dbResults.workshops}
                  icon={Presentation}
                  onSelect={go}
                  tone="primary"
                />
              </>
            )}

            {/* Navigation Pages */}
            {visibleSections.map((section) => {
              const filteredItems = query.trim()
                ? section.items
                    .filter((item) => item.label.toLowerCase().includes(normalizedQuery))
                    .sort(
                      (left, right) =>
                        Number(right.label.toLowerCase() === normalizedQuery) -
                        Number(left.label.toLowerCase() === normalizedQuery),
                    )
                : section.items;

              if (filteredItems.length === 0) return null;

              return (
                <CommandGroup
                  key={section.key}
                  heading={
                    <div className="flex items-center gap-1.5 font-bold text-xs text-foreground px-1 py-1">
                      <Compass className="size-4 text-muted-foreground" />
                      <span>{section.heading ?? t("pagesAndAccess")}</span>
                    </div>
                  }
                  className="mb-2"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pt-1">
                    {filteredItems.map((item) => (
                      <CommandItem
                        key={item.key}
                        value={item.label}
                        onSelect={() => go(item.href)}
                        className="flex items-center gap-2.5 p-2.5 cursor-pointer rounded-xl border border-border/40 bg-card/60 hover:border-primary/40 hover:bg-muted/80 transition-all"
                      >
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Compass className="size-4" />
                        </div>
                        <span className="text-xs font-medium text-foreground truncate">
                          {item.label}
                        </span>
                      </CommandItem>
                    ))}
                  </div>
                </CommandGroup>
              );
            })}
          </CommandList>

          {/* Footer Bar */}
          <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd className="rounded px-1.5 py-0.5 text-[10px]">
                  <CornerDownLeft className="size-3 inline" />
                </Kbd>{" "}
                {t("openHint")}
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="rounded px-1.5 py-0.5 text-[10px]">
                  <ArrowUp className="size-2.5 inline" />
                  <ArrowDown className="size-2.5 inline" />
                </Kbd>{" "}
                {t("navigateHint")}
              </span>
            </div>
            {totalDbResultsCount > 0 && (
              <span className="text-primary font-medium">
                {t("dbResultCount", { count: totalDbResultsCount })}
              </span>
            )}
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
