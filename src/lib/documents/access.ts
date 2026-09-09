import { type Capability, can, type Viewer } from "@/lib/capabilities.ts";

export const DOCUMENT_ENTITY_TYPES = [
  "student",
  "professor",
  "council_decision",
  "council_meeting",
  "workshop",
  "correspondence",
  "research_project",
] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

const ACCESS: Record<DocumentEntityType, { view: Capability; manage: Capability }> = {
  student: { view: "students.view", manage: "students.manage" },
  professor: { view: "professors.view", manage: "professors.manage" },
  council_decision: { view: "council.view", manage: "council.manage" },
  council_meeting: { view: "council.view", manage: "council.manage" },
  workshop: { view: "workshops.view", manage: "workshops.manage" },
  correspondence: { view: "correspondence.view", manage: "correspondence.manage" },
  research_project: { view: "research-projects.view", manage: "research-projects.manage" },
};

export function isDocumentEntityType(value: string): value is DocumentEntityType {
  return (DOCUMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

export function canReadDocumentEntity(viewer: Viewer, entityType: DocumentEntityType): boolean {
  return can(viewer, "documents.view", ACCESS[entityType].view);
}

export function canManageDocumentEntity(viewer: Viewer, entityType: DocumentEntityType): boolean {
  return can(viewer, "documents.manage", ACCESS[entityType].manage);
}

export function readableDocumentEntityTypes(viewer: Viewer): DocumentEntityType[] {
  return DOCUMENT_ENTITY_TYPES.filter((entityType) => canReadDocumentEntity(viewer, entityType));
}

export function entityHref(entityType: DocumentEntityType, entityId: string): string | null {
  switch (entityType) {
    case "student":
      return `/students/${entityId}`;
    case "professor":
      return `/professors/${entityId}`;
    case "council_decision":
      return `/council-decisions/${entityId}`;
    case "council_meeting":
      return `/council-meetings/${entityId}`;
    case "workshop":
      return `/workshops/${entityId}`;
    case "correspondence":
      return `/correspondence`;
    case "research_project":
      return `/research-projects`;
  }
}
