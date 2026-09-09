"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface HeaderNavModule {
  path: string;
  group: string;
  label: string;
}

export interface HeaderNavGroup {
  group: string;
  label: string | null;
}

export interface HeaderSettingsSection {
  path: string;
  label: string;
}

export function HeaderBreadcrumb({
  modules,
  groups,
  settingsSections,
}: {
  modules: HeaderNavModule[];
  groups: HeaderNavGroup[];
  settingsSections?: HeaderSettingsSection[];
}) {
  const pathname = usePathname();
  /* The landmark's own name, from the catalogue — it was hardcoded Persian,
     which an English reader's screen reader announced in the wrong language. */
  const t = useTranslations("nav");

  // 1. Dashboard
  if (pathname === "/") {
    const dashboardMod = modules.find((m) => m.path === "/");
    return (
      <Breadcrumb aria-label={t("breadcrumb")}>
        <BreadcrumbList className="gap-1.5 text-xs">
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold text-foreground">
              {dashboardMod?.label ?? t("dashboard")}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // 2. Settings subpages
  if (pathname.startsWith("/settings")) {
    const settingsMod = modules.find((m) => m.path === "/settings");
    const settingsLabel = settingsMod?.label ?? t("settings");

    if (pathname === "/settings") {
      const group = groups.find((g) => g.group === "system");
      return (
        <Breadcrumb aria-label={t("breadcrumb")}>
          <BreadcrumbList className="gap-1.5 text-xs">
            {group?.label && (
              <>
                <BreadcrumbItem>
                  <span className="text-muted-foreground font-normal">{group.label}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </>
            )}
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold text-foreground">
                {settingsLabel}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      );
    }

    const currentSection = settingsSections?.find((s) => s.path === pathname);
    return (
      <Breadcrumb aria-label={t("breadcrumb")}>
        <BreadcrumbList className="gap-1.5 text-xs">
          <BreadcrumbItem>
            <BreadcrumbLink
              href="/settings"
              className="text-muted-foreground hover:text-foreground"
            >
              {settingsLabel}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold text-foreground">
              {currentSection?.label ?? t("settingsSection")}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // 3. Regular modules & subroutes
  const matchedModule = modules.find(
    (m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(`${m.path}/`)),
  );

  if (!matchedModule) {
    return null;
  }

  const group = groups.find((g) => g.group === matchedModule.group);
  const isRoot = pathname === matchedModule.path;

  // Root module page (e.g. /professors, /students, /council-meetings)
  if (isRoot) {
    return (
      <Breadcrumb aria-label={t("breadcrumb")}>
        <BreadcrumbList className="gap-1.5 text-xs">
          {group?.label && (
            <>
              <BreadcrumbItem>
                <span className="text-muted-foreground font-normal">{group.label}</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          )}
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold text-foreground">
              {matchedModule.label}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // Subpages of a module (e.g. /professors/new, /professors/[id], /professors/[id]/edit)
  let subLabel = t("record");
  if (pathname.endsWith("/new")) {
    subLabel = t("newRecord");
  } else if (pathname.endsWith("/edit")) {
    subLabel = t("editRecord");
  } else if (pathname.endsWith("/reports")) {
    subLabel = t("reports");
  } else if (pathname.endsWith("/reconcile")) {
    subLabel = t("reconcile");
  } else if (pathname.endsWith("/cases")) {
    subLabel = t("cases");
  }

  return (
    <Breadcrumb aria-label={t("breadcrumb")}>
      <BreadcrumbList className="gap-1.5 text-xs">
        <BreadcrumbItem>
          <BreadcrumbLink
            href={matchedModule.path}
            className="text-muted-foreground hover:text-foreground"
          >
            {matchedModule.label}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage className="font-semibold text-foreground">{subLabel}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
