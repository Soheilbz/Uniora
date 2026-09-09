import {
  ADMINISTRATOR_TIER,
  CAPABILITIES,
  type Capability,
  ORDINARY_TIER,
  SENIOR_TIER,
} from "./capabilities.ts";

/**
 * The roles every newly provisioned university starts with.
 *
 * Keeping this definition in one place matters operationally: the development
 * seed and the production tenant-creation command must give an institution the
 * same permission model. A second copy would drift silently and make a new
 * university behave differently from the one used during development.
 */
export const DEFAULT_TENANT_ROLES = [
  {
    key: "administrator",
    name: "مدیر سامانه",
    tier: ADMINISTRATOR_TIER,
    capabilities: [...CAPABILITIES] satisfies readonly Capability[],
  },
  {
    key: "research-officer",
    name: "کارشناس پژوهش",
    tier: SENIOR_TIER,
    capabilities: [
      "students.view",
      "students.manage",
      "professors.view",
      "professors.manage",
      "council.view",
      "council.manage",
      "capacity.view",
      "worksheets.view",
      "workshops.view",
      "workshops.manage",
      "calendar.view",
      "calendar.manage",
      "lookups.manage",
      "data.export",
      "data.quality.view",
      "capacity.manage",
      "worksheets.manage",
      "students.sensitive.read",
      "professors.sensitive.read",
      "professors.bank.read",
      "master-data.manage",
      "documents.view",
      "documents.manage",
      "correspondence.view",
      "correspondence.manage",
      "tasks.view",
      "tasks.manage",
      "research-projects.view",
      "research-projects.manage",
    ] satisfies readonly Capability[],
  },
  {
    key: "reader",
    name: "مشاهده‌گر",
    tier: ORDINARY_TIER,
    capabilities: [
      "students.view",
      "professors.view",
      "council.view",
      "capacity.view",
      "worksheets.view",
      "workshops.view",
      "calendar.view",
    ] satisfies readonly Capability[],
  },
] as const;
