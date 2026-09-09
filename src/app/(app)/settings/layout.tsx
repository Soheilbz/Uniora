import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageBody, PageHeader } from "@/components/page-header";
import { SettingsRailLink } from "@/components/settings/rail-link";
import { enabledTenantFeatures } from "@/lib/features.ts";
import { requireModule } from "@/lib/viewer.ts";
import { visibleSettingsSections } from "@/modules/settings/sections.ts";

/**
 * The frame every settings section is drawn in: a rail of sections beside the
 * one being read.
 *
 * A layout rather than something each page renders, so the rail is neither
 * re-rendered nor re-fetched when somebody moves between sections. It is also
 * where the capability filter belongs: a section this person cannot open is not
 * listed, and the route behind it refuses the address as well.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { viewer } = await requireModule("/settings");
  const [nav, settings, enabledFeatures] = await Promise.all([
    getTranslations("nav"),
    getTranslations("settings"),
    enabledTenantFeatures(viewer.tenantId),
  ]);

  const visible = visibleSettingsSections(viewer, enabledFeatures);
  const groups = ["account", "institution", "access", "operations"] as const;

  return (
    <PageBody>
      <PageHeader
        title={nav("settings")}
        description={settings("subtitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: nav("settings") }]}
      />

      {/*
       * A fixed sticky rail beside the panel on desktop and a wrapped, fully
       * visible section list on mobile.
       */}
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
        <nav
          aria-label={nav("settings")}
          className="sticky top-16 z-20 rounded-2xl border border-border/80 bg-card p-2 shadow-xs"
        >
          <div className="flex min-w-0 flex-row flex-wrap gap-4 lg:flex-col lg:gap-3">
            {groups.map((group) => {
              const sections = visible.filter((section) => section.groupKey === group);
              if (sections.length === 0) return null;
              return (
                <section key={group} className="flex flex-col gap-1.5">
                  <h2 className="px-2 text-[10px] font-bold tracking-wide text-muted-foreground">
                    {settings(`nav.group.${group}`)}
                  </h2>
                  <ul className="flex min-w-0 flex-row flex-wrap gap-1 lg:flex-col">
                    {sections.map((section) => (
                      <li key={section.path} className="min-w-0 lg:w-full">
                        <SettingsRailLink
                          href={section.path}
                          label={settings(section.labelKey)}
                          exact={section.path === "/settings"}
                        >
                          <section.icon className="size-4.5 shrink-0" aria-hidden />
                        </SettingsRailLink>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </nav>

        {/* Dynamic settings subpage content */}
        <div className="min-w-0 w-full">{children}</div>
      </div>
    </PageBody>
  );
}
