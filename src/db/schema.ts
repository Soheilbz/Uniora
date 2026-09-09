/**
 * Public Drizzle schema surface. Definitions are grouped by domain under
 * `src/db/schema/`; callers import from this barrel so storage layout can evolve
 * without creating cross-domain import churn.
 */

export * from "./schema/academic.ts";
export * from "./schema/audit.ts";
export * from "./schema/calendar.ts";
export * from "./schema/capacity.ts";
export * from "./schema/core.ts";
export * from "./schema/council.ts";
export * from "./schema/documents.ts";
export * from "./schema/enterprise.ts";
export * from "./schema/enterprise-scim.ts";
export * from "./schema/experience.ts";
export * from "./schema/governance.ts";
export * from "./schema/integrations.ts";
export * from "./schema/operations.ts";
export * from "./schema/platform.ts";
export * from "./schema/registry.ts";
export * from "./schema/research.ts";
export type * from "./schema/types.ts";
export * from "./schema/workflow.ts";
export * from "./schema/workshops.ts";
