import type { Capability, Viewer } from "@/lib/capabilities.ts";
import { can } from "@/lib/capabilities.ts";

export const CUSTOM_FIELD_ENTITY_TYPES = [
  "student",
  "professor",
  "workshop",
  "research_project",
  "correspondence",
] as const;
export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];
export const CUSTOM_FIELD_DATA_TYPES = [
  "text",
  "number",
  "date",
  "boolean",
  "select",
  "multiselect",
] as const;
export type CustomFieldDataType = (typeof CUSTOM_FIELD_DATA_TYPES)[number];

const ACCESS: Record<CustomFieldEntityType, { view: Capability; manage: Capability }> = {
  student: { view: "students.view", manage: "students.manage" },
  professor: { view: "professors.view", manage: "professors.manage" },
  workshop: { view: "workshops.view", manage: "workshops.manage" },
  research_project: { view: "research-projects.view", manage: "research-projects.manage" },
  correspondence: { view: "correspondence.view", manage: "correspondence.manage" },
};

export function isCustomFieldEntityType(value: string): value is CustomFieldEntityType {
  return (CUSTOM_FIELD_ENTITY_TYPES as readonly string[]).includes(value);
}
export function isCustomFieldDataType(value: string): value is CustomFieldDataType {
  return (CUSTOM_FIELD_DATA_TYPES as readonly string[]).includes(value);
}
export function canReadCustomValues(viewer: Viewer, entityType: CustomFieldEntityType): boolean {
  return can(viewer, ACCESS[entityType].view);
}
export function canManageCustomValues(viewer: Viewer, entityType: CustomFieldEntityType): boolean {
  return can(viewer, ACCESS[entityType].manage);
}

export function parseOptions(raw: string): string[] | null {
  const values = raw
    .split(/\r?\n|,/)
    .map((one) => one.trim())
    .filter(Boolean);
  if (
    values.some((one) => one.length > 120) ||
    values.length > 100 ||
    new Set(values).size !== values.length
  )
    return null;
  return values;
}
