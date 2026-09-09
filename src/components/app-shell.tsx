import { CalendarDays, University } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions/session";
import { CalendarSystemProvider } from "@/components/calendar-system-provider";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { directionOf, isLocale } from "@/i18n/routing";
import { can } from "@/lib/capabilities.ts";
import { enabledTenantFeatures } from "@/lib/features.ts";
import { MODULE_GROUPS, modulesFor } from "@/lib/modules";
import { navCounts } from "@/lib/nav-counts.ts";
import type { Viewer } from "@/lib/viewer";
import { readAttention } from "@/modules/attention/queries.ts";
import { attentionFailed, attentionSignals, raisedSignals } from "@/modules/attention/rules.ts";
import { readQuickRecords } from "@/modules/experience/records.ts";
import { unreadNotificationCount } from "@/modules/notifications/queries.ts";
import { readInstitution } from "@/modules/settings/institution-queries.ts";
import { visibleSettingsSections } from "@/modules/settings/sections.ts";
import { GlobalSearch, type SearchSection } from "./global-search";

import { AlertsBell } from "./shell/alerts-bell";
import { AppearanceControls } from "./shell/appearance-controls";
import { HeaderBreadcrumb } from "./shell/header-breadcrumb";
import { NavMain } from "./shell/nav-main";
import { NavUser } from "./shell/nav-user";

/* The running build — shown once in the rail footer. Bumped with releases. */
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.8.2";

/**
 * The frame every authenticated screen is drawn in.
 *
 * A Server Component, and that is a substantive choice rather than a stylistic
 * one: the navigation depends on who is signed in and what they may do, so
 * deciding it here means a person is never sent markup for a register they
 * cannot open — not hidden, not disabled, absent.
 *
 * Built on shadcn's sidebar rather than hand-rolled markup. What that buys is
 * not the visual: it is the collapse behaviour, the mobile sheet, the keyboard
 * shortcut, the rail, and the cookie that remembers the state — all of which are
 * things an office notices immediately and nobody wants to write twice.
 *
 * `render` rather than `asChild`, throughout. That is Base UI's API and the one
 * shadcn now ships against: the component renders *your* element with its own
 * behaviour merged in, so `SidebarMenuButton` becomes a real Next `Link` and
 * keeps prefetching and client-side navigation.
 */
export async function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const t = await getTranslations();
  const app = await getTranslations("app");
  const settings = await getTranslations("settings");
  const locale = await getLocale();
  const direction = directionOf(isLocale(locale) ? locale : "fa");

  /*
   * The menu is decided here, from what this person actually holds.
   *
   * Not rendered-then-hidden: a module the viewer cannot open produces no markup
   * at all, so the shape of an office somebody has no access to is not sitting
   * in the page source for them to read. Empty groups fall out on their own — a
   * reader with no research permissions sees no research heading, not a heading
   * over nothing.
   */
  const [counts, attention, letterhead, notificationUnreadCount, enabledFeatures, quickRecords] =
    await Promise.all([
      navCounts(viewer),
      readAttention(viewer),
      readInstitution(viewer.tenantId),
      unreadNotificationCount(viewer),
      enabledTenantFeatures(viewer.tenantId),
      readQuickRecords(viewer),
    ]);
  const modules = modulesFor(viewer, enabledFeatures);

  /*
   * Computed here, in the shell, because the bell is in the shell: every page
   * gets the same answer and the reader can act on it from wherever they are.
   * One statement, and it never throws — see `readAttention`.
   */
  const signals = attentionSignals(attention);
  const raised = raisedSignals(signals);

  const groups = MODULE_GROUPS.filter((group) =>
    modules.some((module) => module.group === group.group),
  ).map((group) => ({
    group: group.group,
    label: group.labelKey ? t(group.labelKey) : null,
  }));

  const settingsSections = visibleSettingsSections(viewer, enabledFeatures).map((section) => ({
    path: section.path,
    label: settings(section.labelKey),
  }));

  /*
   * The palette's destinations, resolved here rather than in the browser.
   *
   * Same list, same filter, same reason: what the client component receives is
   * only what this person may open, so there is nothing in the page source
   * describing a screen they cannot reach.
   */
  const searchSections: SearchSection[] = [
    {
      key: "pinned",
      heading: t("search.pinned"),
      items: quickRecords.pins.map((item) => ({
        key: `pin:${item.entityType}:${item.entityId}`,
        label: item.label,
        href: item.href,
      })),
    },
    {
      key: "recent",
      heading: t("search.recent"),
      items: quickRecords.recent
        .filter(
          (item) =>
            !quickRecords.pins.some(
              (pin) => pin.entityType === item.entityType && pin.entityId === item.entityId,
            ),
        )
        .map((item) => ({
          key: `recent:${item.entityType}:${item.entityId}`,
          label: item.label,
          href: item.href,
        })),
    },
    {
      key: "pages",
      heading: t("search.pages"),
      items: modules.map((module) => ({
        key: module.key,
        label: t(module.labelKey),
        href: module.path,
      })),
    },
  ];

  /*
   * `side` is a physical side, and has to be worked out rather than left alone.
   *
   * The sidebar reserves its space with an in-flow spacer — which follows the
   * writing direction on its own — but paints the panel itself with a `position:
   * fixed` element pinned by `left-0` / `right-0`, chosen from this prop.
   * Physical offsets do not flip in RTL, so leaving the default meant the gap
   * opened on the right while the panel was drawn on the left: a 256px band of
   * empty background down one edge and a sidebar sitting on top of the content
   * down the other.
   */
  const side = direction === "rtl" ? "right" : "left";

  /*
   * And the divider, which the same inconsistency puts on the wrong edge.
   *
   * The component positions the panel with physical offsets but draws its border
   * with *logical* ones (`border-s` / `border-e`). Those two disagree in a
   * right-to-left document: pinned physically to the right, the panel's
   * inline-start is its right edge — the outside of the window — so the divider
   * is drawn against the screen edge where nothing can see it, and the seam
   * facing the content has none.
   *
   * Corrected here rather than in the component: `shadcn add` overwrites
   * `components/ui`, and a fix living there would be lost the next time the
   * sidebar is updated.
   */
  const divider =
    direction === "rtl"
      ? "group-data-[side=right]:border-s-0 group-data-[side=right]:border-l"
      : "";

  return (
    /*
     * `h-svh overflow-hidden`, overriding the primitive's `min-h-svh`.
     *
     * `min-h` sets a floor, not a ceiling: the wrapper grew to whatever the page
     * contained, so `#main-content`'s `overflow-y: auto` never had anything to
     * scroll and the *document* scrolled instead. Two consequences, both real —
     * the sidebar and the toolbar scrolled away with a long register, and on a
     * phone the body and the inner panel were both scrollable at once, which is
     * the nested-scrollport problem this shell was built to avoid.
     *
     * A fixed frame with one scrolling panel is also what the application
     * does, and what the office has in their hands.
     */
    <SidebarProvider className="h-svh overflow-hidden">
      {/*
       * The first thing the keyboard reaches, and invisible until it does.
       *
       * Without it, every screen costs a keyboard or screen-reader user the
       * whole sidebar before the first field of the page they asked for — on
       * this application, twelve links, on every navigation.
       */}
      <a
        data-print-hide
        href="#main-content"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50"
      >
        {t("nav.skipToContent")}
      </a>

      {/* Chrome, hidden on paper by attribute — see the print block in
          `globals.css` for why it is never hidden by element name. */}
      <Sidebar
        data-print-hide
        dir={direction}
        side={side}
        collapsible="icon"
        className={divider}
        role="complementary"
        aria-label={t("nav.primary")}
      >
        <SidebarHeader className="border-b border-sidebar-border/60 pb-3">
          {/*
           * The institution's mark and name, to the same metrics as shadcn's
           * team-switcher header: the crest mark in a `size-9` well, the university
           * name over the faculty name in tight leading. Collapsed to icons the text
           * stands down and the mark centres in the strip.
           */}
          <div className="flex items-center gap-3 p-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
            {letterhead.crest ? (
              /* biome-ignore lint/performance/noImgElement: data URL crest from institution profile */
              <img
                src={letterhead.crest}
                alt=""
                className="size-9 shrink-0 rounded-xl bg-card object-contain p-1 border border-sidebar-border/80 shadow-2xs"
              />
            ) : (
              <div className="flex aspect-square size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-2xs">
                <University className="size-4.5" aria-hidden />
              </div>
            )}
            <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-bold text-sidebar-foreground">
                {letterhead.name || app("name")}
              </span>
              {letterhead.faculty ? (
                <span className="truncate text-xs font-semibold text-primary">
                  {letterhead.faculty}
                </span>
              ) : letterhead.nameEn ? (
                <span
                  className="truncate text-[11px] text-sidebar-foreground/70 font-mono"
                  dir="ltr"
                >
                  {letterhead.nameEn}
                </span>
              ) : null}
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <NavMain
            modules={modules.map((module) => ({
              key: module.key,
              path: module.path,
              group: module.group,
              label: t(module.labelKey),
            }))}
            groups={groups}
            counts={counts}
            locale={locale}
            filterLabel={t("nav.searchMenu")}
            navLabel={t("nav.primary")}
          />
        </SidebarContent>

        <SidebarFooter>
          <NavUser
            name={viewer.name}
            roleName={viewer.roleName}
            profileLabel={t("nav.settings")}
            signOutLabel={t("auth.signOut")}
            menuLabel={t("nav.account")}
            onSignOut={signOut}
          />
          {/*
           * The one-line footer: what is running.
           *
           * An office supporting this installation asks «which version is
           * this?» over the phone; the answer living one glance away — rather
           * than in a settings screen — is the whole feature.
           */}
          <p className="select-none px-2 pb-1 text-[10px] leading-4 text-sidebar-foreground/70">
            {t("app.versionLabel")} {APP_VERSION}
          </p>
        </SidebarFooter>

        {/* The drag handle on the sidebar's edge. Cheap to include and the thing
            people reach for before they find the keyboard shortcut. */}
        <SidebarRail aria-label={t("nav.toggleSidebar")} title={t("nav.toggleSidebar")} />
      </Sidebar>

      <SidebarInset>
        <header
          data-print-hide
          className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-background/95 px-4 shadow-xs"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <SidebarTrigger
              className="size-8 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("nav.toggleSidebar")}
            />
            <span aria-hidden className="h-4 w-px bg-border/80 shrink-0" />
            <HeaderBreadcrumb
              modules={modules.map((m) => ({
                path: m.path,
                group: m.group,
                label: t(m.labelKey),
              }))}
              groups={groups}
              settingsSections={settingsSections}
            />
          </div>

          {/* The search bar takes the middle, which is where it is on the
              application shell and where people already reach for it. */}
          <div className="flex min-w-0 flex-1 justify-center px-2">
            <div className="flex w-full max-w-sm min-w-0 items-center gap-1.5 lg:max-w-md">
              <GlobalSearch sections={searchSections} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/*
             * A link, not a button with a handler: the controls beside it change
             * a preference, this one goes somewhere, and a destination the
             * middle mouse button cannot open is not a link.
             */}
            {can(viewer, "calendar.view") && (
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                render={
                  <Link
                    href="/calendar"
                    prefetch={false}
                    aria-label={t("nav.calendar")}
                    title={t("nav.calendar")}
                  >
                    <CalendarDays className="size-4" aria-hidden />
                  </Link>
                }
              />
            )}

            <AlertsBell
              signals={signals}
              raisedCount={raised.length}
              failed={attentionFailed(signals)}
              locale={locale}
              notificationUnreadCount={notificationUnreadCount}
            />

            <AppearanceControls
              locale={locale}
              themeLabel={t("appearance.toggleTheme")}
              localeLabel={t("appearance.toggleLocale")}
            />
          </div>
        </header>

        {/*
         * A div, not a `main` — `SidebarInset` already renders one.
         *
         * Two nested `main` elements is invalid HTML and, more to the point, two
         * "main content" landmarks: a screen reader offers the reader a choice
         * between them with nothing to tell them apart. The landmark is the
         * inset's; this is only the scroll container.
         *
         * `tabIndex={-1}` because a link to a `div` moves the browser's scroll
         * position but not its focus, and a skip link that scrolls without
         * moving focus is worse than none: the next Tab continues from the
         * sidebar the reader just skipped.
         */}
        <div
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 flex flex-col overflow-y-auto p-3 outline-none md:p-4"
        >
          <CalendarSystemProvider
            calendarSystem={letterhead.calendarSystem === "gregorian" ? "gregorian" : "jalali"}
          >
            {children}
          </CalendarSystemProvider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
