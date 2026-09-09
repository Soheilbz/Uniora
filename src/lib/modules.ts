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
import { type Capability, can, type Viewer } from "./capabilities";
import type { FeatureKey } from "./features";

/**
 * Every screen this application has, in the order the office reads them.
 *
 * One table, and it is the single source for the sidebar, the command palette
 * and the "you have no permission for this" decision. Keeping one registry
 * prevents navigation, route guards and permission requirements from drifting.
 *
 * The grouping is the institution's own — registry, research and system.
 */

export type ModuleGroup = "main" | "registry" | "research" | "system";

export interface ModuleDef {
  key: string;
  path: string;
  group: ModuleGroup;
  /** Catalogue key, so the menu is translated rather than transliterated. */
  labelKey: string;
  icon: LucideIcon;
  /**
   * What a person must hold to open it. An array means *all* of them: a screen
   * that reads two registers needs permission for both, and holding one is not
   * enough to open a page half of which would be empty.
   */
  capability?: Capability | Capability[];
  /** Optional tenant product flag; authorization is still enforced separately. */
  feature?: FeatureKey;
}

/** Every screen implemented by this release. */
export const ALL_MODULES: readonly ModuleDef[] = [
  {
    key: "dashboard",
    path: "/",
    group: "main",
    labelKey: "nav.dashboard",
    icon: LayoutDashboard,
  },

  {
    key: "students",
    path: "/students",
    group: "registry",
    labelKey: "nav.students",
    icon: GraduationCap,
    capability: "students.view",
  },
  {
    key: "professors",
    path: "/professors",
    group: "registry",
    labelKey: "nav.professors",
    icon: UserRound,
    capability: "professors.view",
  },

  {
    key: "council-meetings",
    path: "/council-meetings",
    group: "research",
    labelKey: "nav.councilMeetings",
    icon: ClipboardList,
    capability: "council.view",
  },
  {
    key: "council-decisions",
    path: "/council-decisions",
    group: "research",
    labelKey: "nav.councilDecisions",
    icon: Scale,
    capability: "council.view",
  },
  {
    key: "professor-capacity",
    path: "/professor-capacity",
    group: "research",
    labelKey: "nav.professorCapacity",
    icon: Gauge,
    capability: "capacity.view",
  },
  {
    key: "reviewer-counts",
    path: "/reviewer-counts",
    group: "research",
    labelKey: "nav.reviewerCounts",
    icon: ListTree,
    capability: ["council.view", "professors.view"],
  },
  {
    key: "worksheets",
    path: "/worksheets",
    group: "research",
    labelKey: "nav.worksheets",
    icon: FileSpreadsheet,
    capability: "worksheets.view",
  },
  {
    key: "calendar",
    path: "/calendar",
    group: "research",
    labelKey: "nav.calendar",
    icon: CalendarDays,
    capability: "calendar.view",
  },
  {
    key: "workshops",
    path: "/workshops",
    group: "research",
    labelKey: "nav.workshops",
    icon: Award,
    capability: "workshops.view",
  },
  {
    key: "tasks",
    path: "/tasks",
    group: "research",
    labelKey: "nav.tasks",
    icon: Workflow,
    capability: "tasks.view",
    feature: "workflow",
  },
  {
    key: "correspondence",
    path: "/correspondence",
    group: "research",
    labelKey: "nav.correspondence",
    icon: BriefcaseBusiness,
    capability: "correspondence.view",
    feature: "correspondence",
  },
  {
    key: "research-projects",
    path: "/research-projects",
    group: "research",
    labelKey: "nav.researchProjects",
    icon: FolderKanban,
    capability: "research-projects.view",
    feature: "research-projects",
  },
  {
    key: "documents",
    path: "/documents",
    group: "research",
    labelKey: "nav.documentCenter",
    icon: FileArchive,
    capability: "documents.view",
  },

  {
    key: "settings",
    path: "/settings",
    group: "system",
    labelKey: "nav.settings",
    icon: Settings,
  },
];

/** Every screen this release actually offers. */
export const MODULES: readonly ModuleDef[] = ALL_MODULES;

/** The group headings, in the order they appear. `main` has no heading. */
export const MODULE_GROUPS: readonly { group: ModuleGroup; labelKey: string | null }[] = [
  { group: "main", labelKey: null },
  { group: "registry", labelKey: "group.registry" },
  { group: "research", labelKey: "group.research" },
  { group: "system", labelKey: "group.system" },
];

/**
 * The screens this person may open.
 *
 * Filtered on the server, so a module the viewer cannot reach is not rendered
 * and its markup never leaves the server.
 */
export function modulesFor(viewer: Viewer, enabledFeatures?: ReadonlySet<FeatureKey>): ModuleDef[] {
  return MODULES.filter((module) => {
    if (module.feature && enabledFeatures && !enabledFeatures.has(module.feature)) return false;
    if (!module.capability) return true;
    return can(viewer, ...[module.capability].flat());
  });
}

export function moduleFor(path: string): ModuleDef | undefined {
  return MODULES.find((module) => module.path === path);
}
