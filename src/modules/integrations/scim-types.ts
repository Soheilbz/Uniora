export const SCIM_SCOPES = [
  "scim.users.read",
  "scim.users.write",
  "scim.groups.read",
  "scim.groups.write",
] as const;

export type ScimScope = (typeof SCIM_SCOPES)[number];
