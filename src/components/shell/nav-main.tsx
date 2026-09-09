"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { toLocaleDigits } from "@/lib/digits.ts";

/**
 * The menu: the institution's screens, grouped, counted, and filterable.
 *
 * A client component for two reasons and no others — the active entry has to be
 * derived from the current path, and the filter box has to narrow the list as
 * somebody types. What it renders is decided on the server: `modules` arrives
 * already filtered to what this person may open, so a screen they cannot reach
 * is not in this list to be found by typing its name.
 */

export interface NavModule {
  key: string;
  path: string;
  group: string;
  label: string;
}

export interface NavGroup {
  group: string;
  label: string | null;
}

/**
 * Whether an entry is the one being read.
 *
 * A prefix match, so `/students/40012345/edit` still lights «دانشجویان» — a menu
 * that goes blank the moment somebody opens a record is a menu that stops
 * telling them where they are. The dashboard is matched exactly, because `/` is
 * a prefix of everything.
 */
function isActive(pathname: string, path: string): boolean {
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function NavMain({
  modules,
  groups,
  counts,
  locale,
  filterLabel,
  navLabel,
}: {
  modules: NavModule[];
  groups: NavGroup[];
  counts: Partial<Record<string, number>>;
  locale: string;
  filterLabel: string;
  navLabel: string;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [filter, setFilter] = useState("");
  const rtl = locale.startsWith("fa");

  const matching = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return modules;
    return modules.filter((module) => module.label.toLowerCase().includes(needle));
  }, [modules, filter]);

  return (
    <>
      {/*
       * The filter stands down when the rail is icons only: there is no room for
       * a text field, and a search box in a 48px strip is a box nobody can type
       * into.
       */}
      <div className="relative px-2 pb-1 group-data-[collapsible=icon]:hidden">
        <Search
          className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/65"
          aria-hidden
        />
        <SidebarInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={filterLabel}
          aria-label={filterLabel}
          className="ps-8 text-xs"
        />
      </div>

      {/*
       * The navigation landmark, which the primitive does not supply — shadcn's
       * sidebar is a stack of divs. Without it there is nothing to jump to, so a
       * screen-reader user reaching this application has exactly two
       * destinations and finds the register by arrowing until links appear.
       */}
      <nav aria-label={navLabel} className="flex flex-col">
        {groups.map((group) => {
          const items = matching.filter((module) => module.group === group.group);
          if (items.length === 0) return null;

          return (
            <SidebarGroup key={group.group}>
              {/*
               * Not upper-cased. Persian has no case, so `uppercase` does
               * nothing to «پژوهش» except space its letters apart.
               *
               * `font-medium` because this is the only line in the rail that is
               * neither a link nor a value; at the primitive's regular weight it
               * reads as a disabled entry rather than a heading.
               */}
              {group.label && (
                <SidebarGroupLabel className="font-medium">{group.label}</SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((module) => {
                    const count = counts[module.key];
                    /*
                     * Nothing is shown for a count of zero. A badge is a
                     * quantity worth walking over to; «۰» beside every entry of
                     * a fresh installation is a wall of noughts. Grouped in
                     * Latin and then transliterated, which is what the rest of
                     * the product does with a large number.
                     */
                    const badge =
                      count !== undefined && count > 0
                        ? toLocaleDigits(count.toLocaleString("en-US"), locale)
                        : "";

                    return (
                      <SidebarMenuItem key={module.key}>
                        <SidebarMenuButton
                          isActive={isActive(pathname, module.path)}
                          /*
                           * The tooltip is the only thing that names a button
                           * when the rail is collapsed to icons, so the
                           * collapsed state stays usable rather than becoming a
                           * column of guesses.
                           */
                          tooltip={{
                            children: module.label,
                            /*
                             * The tooltip opens away from the rail, which means
                             * the opposite physical side in each direction. The
                             * primitive's default of `right` is correct in an
                             * English window and lays the tooltip *over* the
                             * rail in a Persian one — where the rail is pinned
                             * to the right — so the label for a collapsed icon
                             * would be drawn on top of the icons it names.
                             */
                            side: rtl ? "left" : "right",
                          }}
                          render={
                            <Link href={module.path} prefetch={false}>
                              <NavIcon module={module.key} />
                              <span>{module.label}</span>
                            </Link>
                          }
                        />
                        {/* A quiet pill rather than a bare number: the border is
                            what separates «۵٬۸۱۶» from the label beside it when
                            the row is hovered or active. */}
                        {badge !== "" && (
                          <SidebarMenuBadge className="rounded-full border border-sidebar-border bg-sidebar px-1.5 text-[11px] text-sidebar-foreground/80">
                            {badge}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        {/*
         * A filter that matched nothing says so. An empty rail reads as a
         * permissions problem — "my menu has disappeared" — rather than as a
         * search with no results.
         */}
        {matching.length === 0 && (
          <p className="px-4 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {t("noMatch")}
          </p>
        )}
      </nav>
    </>
  );
}

/**
 * The icon for a module, resolved here rather than passed in.
 *
 * A Lucide component is a function, and a function cannot cross from a Server
 * Component into a client one — so the registry's `icon` field stays on the
 * server and the client maps the module's key to the same icon. The map is
 * checked against the registry by a test, so a module added to one and not the
 * other is caught rather than silently rendering nothing.
 */
function NavIcon({ module }: { module: string }) {
  const Icon = NAV_ICONS[module];
  return Icon ? <Icon aria-hidden /> : null;
}

import {
  Award,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  FileArchive,
  FileSpreadsheet,
  FolderKanban,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  Scale,
  Settings,
  UserRound,
  Workflow,
} from "lucide-react";

export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  students: GraduationCap,
  professors: UserRound,
  "council-meetings": ClipboardList,
  "council-decisions": Scale,
  "professor-capacity": Gauge,
  "reviewer-counts": ListTree,
  worksheets: FileSpreadsheet,
  calendar: CalendarDays,
  workshops: Award,
  tasks: Workflow,
  correspondence: BriefcaseBusiness,
  "research-projects": FolderKanban,
  documents: FileArchive,
  settings: Settings,
};
