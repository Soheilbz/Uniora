import {
  ArchiveRestore,
  Building2,
  CalendarClock,
  Crown,
  Download,
  FileText,
  GraduationCap,
  IdCard,
  Info,
  KeyRound,
  ListTree,
  type LucideIcon,
  Palette,
  Scale,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Upload,
  UserCog,
  Users,
  Webhook,
} from "lucide-react";
import { type Capability, can } from "@/lib/capabilities.ts";
import type { FeatureKey } from "@/lib/features.ts";
import type { Viewer } from "@/lib/viewer.ts";

/**
 * The sections of settings, and what each one needs.
 *
 * A registry rather than a list of links in the layout, for the reason the
 * module menu is one: the rail and the route have to read the same row. Two
 * lists of "what this screen requires" drift in a predictable direction —
 * somebody tightens the menu entry, the page keeps the old check, and the
 * section disappears from the rail while staying perfectly reachable by
 * address.
 *
 * Ordered by what a section is *about* rather than by when it was written: the
 * account, then the institution and its vocabulary, then who may do what, then
 * the record of what was done. A rail is read top to bottom, and an
 * administrator looking for the audit log should not pass the CSV exports on
 * the way.
 */
export type SettingsSectionLabelKey =
  | "nav.profile"
  | "nav.appearance"
  | "nav.institution"
  | "nav.lookups"
  | "nav.masterData"
  | "nav.customFields"
  | "nav.regulations"
  | "nav.decisionTemplates"
  | "nav.portals"
  | "nav.users"
  | "nav.roles"
  | "nav.ownership"
  | "nav.audit"
  | "nav.data"
  | "nav.import"
  | "nav.api"
  | "nav.integrations"
  | "nav.scheduledJobs"
  | "nav.retention"
  | "nav.dataQuality"
  | "nav.features"
  | "nav.about";

export interface SettingsSection {
  path: string;
  labelKey: SettingsSectionLabelKey;
  groupKey: "account" | "institution" | "access" | "operations";
  icon: LucideIcon;
  /** One capability, or several that must *all* be held. */
  capability?: Capability | Capability[];
  /** Optional product feature controlling discovery, never authorization. */
  feature?: FeatureKey;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    path: "/settings",
    labelKey: "nav.profile",
    groupKey: "account",
    icon: UserCog,
  },
  {
    path: "/settings/appearance",
    labelKey: "nav.appearance",
    groupKey: "account",
    icon: Palette,
  },
  {
    path: "/settings/institution",
    labelKey: "nav.institution",
    groupKey: "institution",
    icon: Building2,
    capability: "institution.manage",
  },
  {
    path: "/settings/lookups",
    labelKey: "nav.lookups",
    groupKey: "institution",
    icon: ListTree,
    capability: "lookups.manage",
  },
  {
    path: "/settings/master-data",
    labelKey: "nav.masterData",
    groupKey: "institution",
    icon: GraduationCap,
    capability: "master-data.manage",
  },
  {
    path: "/settings/custom-fields",
    labelKey: "nav.customFields",
    groupKey: "institution",
    icon: Tags,
    capability: "custom-fields.manage",
  },
  {
    path: "/settings/regulations",
    labelKey: "nav.regulations",
    groupKey: "institution",
    icon: Scale,
    capability: "regulations.manage",
  },
  {
    path: "/settings/decision-templates",
    labelKey: "nav.decisionTemplates",
    groupKey: "institution",
    icon: FileText,
    capability: "templates.manage",
  },
  {
    path: "/settings/portals",
    labelKey: "nav.portals",
    groupKey: "institution",
    icon: IdCard,
    capability: "users.manage",
    feature: "portals",
  },
  {
    path: "/settings/users",
    labelKey: "nav.users",
    groupKey: "access",
    icon: Users,
    capability: "users.manage",
  },
  {
    path: "/settings/roles",
    labelKey: "nav.roles",
    groupKey: "access",
    icon: ShieldCheck,
    capability: "roles.manage",
  },
  {
    path: "/settings/ownership",
    labelKey: "nav.ownership",
    groupKey: "access",
    icon: Crown,
    capability: ["users.manage", "roles.manage"],
  },
  {
    path: "/settings/audit",
    labelKey: "nav.audit",
    groupKey: "access",
    icon: ScrollText,
    capability: "audit.view",
  },
  {
    path: "/settings/data",
    labelKey: "nav.data",
    groupKey: "operations",
    icon: Download,
    capability: "data.export",
  },
  {
    path: "/settings/import",
    labelKey: "nav.import",
    groupKey: "operations",
    icon: Upload,
    capability: "workshops.manage",
  },
  {
    path: "/settings/api",
    labelKey: "nav.api",
    groupKey: "operations",
    icon: KeyRound,
    capability: "api.manage",
  },
  {
    path: "/settings/integrations",
    labelKey: "nav.integrations",
    groupKey: "operations",
    icon: Webhook,
    capability: "integrations.manage",
  },
  {
    path: "/settings/scheduled-jobs",
    labelKey: "nav.scheduledJobs",
    groupKey: "operations",
    icon: CalendarClock,
    capability: "reports.schedule",
  },
  {
    path: "/settings/retention",
    labelKey: "nav.retention",
    groupKey: "operations",
    icon: ArchiveRestore,
    capability: "retention.manage",
  },
  {
    path: "/settings/data-quality",
    labelKey: "nav.dataQuality",
    groupKey: "operations",
    icon: ShieldCheck,
    capability: "data.quality.view",
  },
  {
    path: "/settings/features",
    labelKey: "nav.features",
    groupKey: "operations",
    icon: SlidersHorizontal,
    capability: "features.manage",
  },
  {
    path: "/settings/about",
    labelKey: "nav.about",
    groupKey: "operations",
    icon: Info,
  },
];

/** The section a path belongs to, for the gate at the top of each route. */
export function sectionFor(path: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.path === path);
}
/** The settings surface this viewer is allowed to discover in navigation. */
export function visibleSettingsSections(
  viewer: Viewer,
  enabledFeatures?: ReadonlySet<FeatureKey>,
): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => {
    if (section.feature && enabledFeatures && !enabledFeatures.has(section.feature)) return false;
    if (!section.capability) return true;
    const required = Array.isArray(section.capability) ? section.capability : [section.capability];
    return can(viewer, ...required);
  });
}
