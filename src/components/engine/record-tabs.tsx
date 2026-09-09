"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * A record's sections, as tabs.
 *
 * Which tab is open is deliberately *not* in the URL. A tab is a way of reading
 * one record, not a different record, and putting it in the address bar would
 * make the browser's back button walk tabs instead of leaving the page. The
 * record's own address is the identity worth sharing.
 */
export function RecordTabs({
  tabs,
}: {
  tabs: { value: string; label: string; content: ReactNode }[];
}) {
  /*
   * Two tabs under one value, named rather than suffered.
   *
   * This is not defensive programming against a hypothetical. A record's tabs
   * are assembled at request time from its field groups plus whatever the page
   * adds, and the student register's groups already contain one called
   * «history» — so did the audit trail's tab, once. The result was not a
   * cosmetic duplicate: React warned about the key, Base UI registered both,
   * two tabs reported themselves selected, and the re-render loop between them
   * took the page down with «Maximum update depth exceeded» — a message that
   * points at the tabs library and not at the collision.
   *
   * Thrown, because the alternative is that same crash a moment later with a
   * worse message. The names are in it: a page assembling its own tabs is the
   * only thing that can fix this, and it needs to know which two clashed.
   */
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (seen.has(tab.value)) {
      throw new Error(
        `RecordTabs: two tabs share the value "${tab.value}" (${tabs
          .filter((one) => one.value === tab.value)
          .map((one) => one.label)
          .join(" / ")}). Tab values must be unique — see the note in record-tabs.tsx.`,
      );
    }
    seen.add(tab.value);
  }

  return (
    <Tabs defaultValue={tabs[0]?.value ?? ""} className="flex flex-col flex-1 min-h-0">
      {/*
       * One row that scrolls, never a wrap, with each tab sized to its label.
       *
       * `overflow-y-hidden` is not redundant beside `overflow-x-auto`: CSS
       * computes the *other* axis to `auto` as soon as one axis is not
       * `visible`, so asking for a horizontal scroller silently asks for a
       * vertical one — and this pill overflows its own box by a fraction of a
       * pixel, which some desktop browsers draw as a visible scrollbar stub at the head of the
       * strip.
       *
       * `flex-none` overrides the `flex-1` the trigger ships with. Stretching
       * five tabs across a wide record page spaces the labels out until they
       * stop reading as one group, and inside a scroller it is circular: the
       * tabs would size from the list while the list sizes from its tabs.
       */}
      <TabsList className="!h-auto w-full max-w-full flex-wrap justify-start rounded-xl border border-primary/30 bg-primary/10 p-1.5 shadow-sm gap-1.5 shrink-0 dark:border-sidebar-border dark:bg-sidebar dark:shadow-md">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="!h-auto min-h-8 min-w-[4.5rem] flex-[1_1_4.5rem] whitespace-normal text-center rounded-lg border border-border/70 bg-card/75 px-2.5 py-1.5 text-xs font-semibold leading-5 text-foreground/75 shadow-2xs transition-colors hover:border-primary/40 hover:bg-card hover:text-foreground data-active:border-primary/60 data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm dark:border-sidebar-border/90 dark:bg-sidebar-accent/35 dark:text-sidebar-foreground/85 dark:hover:border-sidebar-primary/60 dark:hover:bg-sidebar-accent/70 dark:hover:text-sidebar-accent-foreground dark:data-active:border-sidebar-primary dark:data-active:bg-sidebar-accent dark:data-active:text-sidebar-accent-foreground"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent
          key={tab.value}
          value={tab.value}
          className="mt-2.5 flex-1 min-h-0 flex flex-col"
        >
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
