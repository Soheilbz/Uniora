import {
  isValidUsernameCharacters,
  USERNAME_MAXIMUM_LENGTH,
  USERNAME_MINIMUM_LENGTH,
} from "./username-policy.ts";

/** Tenant slugs are stable provisioning identifiers and never editable in-app. */
export const TENANT_SLUG_MINIMUM_LENGTH = 2;
export const TENANT_SLUG_MAXIMUM_LENGTH = 64;
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]{2}$/;

export function normalizeTenantSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeLocalUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidTenantSlug(value: string): boolean {
  const normalized = normalizeTenantSlug(value);
  return (
    normalized.length >= TENANT_SLUG_MINIMUM_LENGTH &&
    normalized.length <= TENANT_SLUG_MAXIMUM_LENGTH &&
    TENANT_SLUG_PATTERN.test(normalized)
  );
}

export function isValidLocalUsername(value: string): boolean {
  const normalized = normalizeLocalUsername(value);
  return (
    normalized.length >= USERNAME_MINIMUM_LENGTH &&
    normalized.length <= USERNAME_MAXIMUM_LENGTH &&
    isValidUsernameCharacters(normalized)
  );
}

/**
 * Better Auth requires a globally unique username. Users do not: their login
 * name is scoped to a university. The stored username is therefore an internal,
 * reversible namespace key; `displayUsername` is the local name shown in UI.
 * Length-prefixing makes the mapping collision-free even when slugs or names
 * contain underscores.
 */
export function canonicalAuthUsername(tenantSlug: string, localUsername: string): string {
  const slug = normalizeTenantSlug(tenantSlug);
  const username = normalizeLocalUsername(localUsername);
  if (!isValidTenantSlug(slug) || !isValidLocalUsername(username)) {
    throw new Error("invalid tenant-scoped username");
  }
  return `${slug.length}_${slug}_${username}`;
}

/**
 * Namespace for installation operators. These accounts do not belong to a
 * university, so they must never be accepted by the tenant login form.
 */
export function canonicalPlatformUsername(localUsername: string): string {
  const username = normalizeLocalUsername(localUsername);
  if (!isValidLocalUsername(username)) throw new Error("invalid platform username");
  return `platform_${username}`;
}

export function isPlatformAuthUsername(value: unknown): value is string {
  return typeof value === "string" && /^platform_[a-z0-9._-]{3,64}$/.test(value);
}
