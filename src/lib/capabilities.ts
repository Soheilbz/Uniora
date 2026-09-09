/**
 * What a person is allowed to do, as a closed list.
 *
 * Every screen, every action and every query in this application is gated on one
 * of these. The list is closed on purpose: a capability that can be any string
 * is a capability that can be misspelled, and a misspelled capability in a
 * `has()` check is a permission that silently never matches — a screen nobody
 * can open, or worse, a guard nobody passes and everybody bypasses because the
 * check was written the other way round.
 *
 * The vocabulary is deliberately application-native and closed. Capabilities are
 * enforced on the server where data is read or changed, never only in rendered UI.
 */
export const CAPABILITIES = [
  "students.view",
  "students.manage",
  /** Legacy alias retained for backward compatibility with existing roles. */
  "students.nationality",
  "students.degree",
  /** Explicit access to sensitive student identifiers and identity details. */
  "students.sensitive.read",

  "professors.view",
  "professors.manage",
  "professors.sensitive.read",
  "professors.bank.read",

  "council.view",
  "council.manage",

  "capacity.view",
  "capacity.manage",

  "worksheets.view",
  "worksheets.manage",

  "workshops.view",
  "workshops.manage",

  "calendar.view",
  "calendar.manage",

  "master-data.manage",
  "documents.view",
  "documents.manage",
  "correspondence.view",
  "correspondence.manage",
  "tasks.view",
  "tasks.manage",
  "notifications.manage",
  "research-projects.view",
  "research-projects.manage",

  "lookups.manage",
  "institution.manage",
  "users.manage",
  "roles.manage",
  "saved-views.publish",
  "templates.manage",
  "regulations.manage",
  "features.manage",
  "custom-fields.manage",
  "integrations.manage",
  "api.manage",
  "reports.schedule",
  "retention.manage",
  "security.break-glass",
  "audit.view",
  "data.export",
  "data.quality.view",
  "data.quality.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Role tiers, which answer a different question from capabilities.
 *
 * A capability says what a role may do. A tier says which roles a person may
 * *hand out* — an ordinary clerk with `users.manage` can administer ordinary
 * accounts and cannot promote anyone to their own level or above. Without that,
 * `users.manage` is a privilege-escalation route: grant it once and the holder
 * can grant themselves everything else.
 *
 * Ordered, and the order is the whole meaning. These tiers exist only inside a
 * university. Platform operators are intentionally not represented by tenant
 * roles or tenant capabilities.
 */
export const ROLE_TIERS = ["ordinary", "senior", "administrator"] as const;
export type RoleTier = (typeof ROLE_TIERS)[number];

export const ORDINARY_TIER = ROLE_TIERS.indexOf("ordinary");
export const SENIOR_TIER = ROLE_TIERS.indexOf("senior");
export const ADMINISTRATOR_TIER = ROLE_TIERS.indexOf("administrator");

export function tierName(rank: number): RoleTier {
  return ROLE_TIERS[rank] ?? "ordinary";
}

export function tierRank(name: string): number {
  const rank = (ROLE_TIERS as readonly string[]).indexOf(name);
  return rank < 0 ? ORDINARY_TIER : rank;
}

/**
 * Whether an account is in use, and if not, how permanently.
 *
 * `suspended` is reversible and keeps the role assignments; `revoked` destroys
 * the credential. They are different words on screen because they are different
 * decisions, and an administrator who confuses them either locks somebody out
 * for a morning or destroys an account they meant to pause.
 */
export const USER_STANDINGS = ["active", "suspended", "revoked"] as const;
export type UserStanding = (typeof USER_STANDINGS)[number];

/**
 * Who is asking, and what they may do.
 *
 * The *subject* of an authorisation decision, kept here beside the vocabulary it
 * is expressed in and deliberately away from the code that reads it out of the
 * database. `lib/viewer.ts` builds one of these; everything else consumes it.
 *
 * That split is not tidiness. `viewer.ts` reaches the session, which reaches
 * Better Auth, which opens a connection pool the moment it is imported — so
 * while the menu's filter lived next to it, deciding "may this person see the
 * students register" could not be answered without a database. It is a question
 * about a list of strings.
 */
export interface Viewer {
  userId: string;
  name: string;
  /** The university whose rows this person may see. */
  tenantId: string;
  capabilities: readonly Capability[];
  /**
   * The name of the highest-tier role this person holds — «مدیر سامانه».
   *
   * Shown under their name in the rail, because "who am I signed in as" is a
   * question an operator asks on a shared machine, and a name alone does not
   * answer it when the same person has an ordinary account and an
   * administrative one.
   */
  roleName: string | null;
  /**
   * The highest tier among this person's roles.
   *
   * Not "what they may do" — that is `capabilities` — but "whose accounts and
   * roles they may administer". See `ROLE_TIERS` above.
   */
  tier: number;
  /** Security state used by the authenticated layout. */
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  requireMfa: boolean;
  tenantTimezone: string;
  tenantPasswordMinLength: number;
  isTenantOwner: boolean;
}

/** Whether this person holds every capability named. */
export function can(viewer: Viewer, ...required: Capability[]): boolean {
  /* Every, not some: a screen that reads two protected domains must be authorised
     for both so partial data never becomes an accidental side channel. */
  return required.every((capability) => viewer.capabilities.includes(capability));
}
