import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./fragments.ts";

/* ── Institutions ─────────────────────────────────────────────────────────── */

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    /** Immutable routing/login namespace assigned at provisioning time. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Platform lifecycle. Tenant users cannot edit this row. */
    status: text("status").notNull().default("active"),
    provisioningStatus: text("provisioning_status").notNull().default("active"),
    /** Queue request that owns an in-progress platform provisioning attempt. */
    provisioningRequestId: uuid("provisioning_request_id"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("tenants_status_check", sql`${table.status} in ('active','suspended','archived')`),
    check(
      "tenants_provisioning_status_check",
      sql`${table.provisioningStatus} in ('provisioning','active','failed')`,
    ),
    uniqueIndex("tenants_provisioning_request_idx")
      .on(table.provisioningRequestId)
      .where(sql`${table.provisioningRequestId} is not null`),
  ],
);

/* ── Identity ─────────────────────────────────────────────────────────────── */

/**
 * Better Auth's shared rate-limit bucket.
 *
 * This table intentionally has no tenant key or RLS policy: the limiter runs
 * before a request has been authenticated, and its key is the caller/request
 * axis rather than institutional data. Keeping it in PostgreSQL makes the
 * protection consistent when the web process is scaled horizontally.
 */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/*
 * The four tables below are Better Auth's, in the shape Better Auth expects.
 *
 * `id` is text because that is Better Auth's native identifier format. The
 * authentication schema adds `tenant_id` to bind an account to one university.
 */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    username: text("username").unique(),
    displayUsername: text("display_username"),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    /** Set when access is withdrawn; the account stays for the audit trail. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    /**
     * Why, in the administrator's own words, shown beside the name.
     *
     * A suspension with no reason on it is a suspension somebody has to ask
     * about — and «مرخصی زایمان» and «تحت بررسی» are the same state with very
     * different answers to "when is this person coming back". Free text because
     * the reasons are the institution's and a closed list would be wrong within
     * a month.
     */
    suspendedReason: text("suspended_reason"),
    /** Temporary credentials are unusable for normal work until replaced. */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    lastLoginIp: text("last_login_ip"),
    lastLoginUserAgent: text("last_login_user_agent"),
    employmentStart: date("employment_start"),
    employmentEnd: date("employment_end"),
    accountExpiresAt: timestamp("account_expires_at", { withTimezone: true }),
    /** MFA secrets are encrypted with an application key before persistence. */
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEncrypted: text("mfa_secret_encrypted"),
    mfaPendingSecretEncrypted: text("mfa_pending_secret_encrypted"),
    ...timestamps,
  },
  (table) => [
    index("user_tenant_idx").on(table.tenantId),
    uniqueIndex("user_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("user_tenant_display_username_idx")
      .on(table.tenantId, table.displayUsername)
      .where(sql`${table.tenantId} is not null and ${table.displayUsername} is not null`),
    check(
      "user_employment_dates_check",
      sql`${table.employmentEnd} is null or ${table.employmentStart} is null or ${table.employmentEnd} >= ${table.employmentStart}`,
    ),
    check(
      "user_mfa_consistency_check",
      sql`not ${table.mfaEnabled} or ${table.mfaSecretEncrypted} is not null`,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Set only after the second factor succeeds for this session. */
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    /** Fresh-password or MFA verification window for sensitive actions. */
    elevatedUntil: timestamp("elevated_until", { withTimezone: true }),
    /** Per-session brake against TOTP brute force after a bearer session is stolen. */
    mfaFailedCount: integer("mfa_failed_count").notNull().default(0),
    mfaLockedUntil: timestamp("mfa_locked_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("session_user_idx").on(table.userId),
    /*
     * Sessions are read on every request and swept on a timer. At a couple of
     * thousand concurrent users this index is what keeps the sweep from being a
     * sequential scan of the hottest table in the system.
     */
    index("session_expires_idx").on(table.expiresAt),
    check("session_mfa_failed_count_check", sql`${table.mfaFailedCount} between 0 and 20`),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    ...timestamps,
  },
  (table) => [index("account_user_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * The per-account brake on password guessing.
 *
 * One row per account that has a failed sign-in on record; no row is a clean
 * slate, and a successful sign-in deletes the row.
 *
 * ── Why an account axis, when a rate limiter exists ─────────────────────────
 *
 * A limiter keyed by the caller's address bounds how fast *one machine* may
 * guess. It is blind to a guesser who rotates addresses, and behind a
 * university's NAT it cannot tell the attacker from the two hundred colleagues
 * sharing that address. This counts the other axis — failures against *one
 * account*, wherever they come from — and the two are complementary rather than
 * alternatives.
 *
 * ── Keyed by account id, never by the typed name ────────────────────────────
 *
 * A username that matches no account cannot be locked, because there is nothing
 * to lock. Keying on attacker-controlled text would let anybody grow this table
 * without bound by inventing names.
 *
 * ── No tenant column, and no row-level security ─────────────────────────────
 *
 * Like `session` and `user`, this is read before any tenant is known: deciding
 * whether a sign-in may proceed is exactly the operation that happens before
 * there is a university to scope to.
 */
export const loginAttempts = pgTable("login_attempts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Consecutive failures inside the window; reset by a successful sign-in. */
  failedCount: integer("failed_count").notNull().default(0),
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull(),
  /** While this is in the future, a sign-in is refused without verifying anything. */
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/* ── Authorisation ────────────────────────────────────────────────────────── */

/**
 * A named bundle of capabilities, owned by one institution.
 *
 * Roles are per-tenant rather than global because two universities running on
 * this deployment do not share an org chart: one office's «کارشناس پژوهش» is not
 * the other's, and a shared role would let a change made for one institution
 * silently alter permissions in another.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),

    /** Stable identifier used in code and seeds; the name is what staff read. */
    key: text("key").notNull(),
    name: text("name").notNull(),

    /*
     * Which roles this one may hand out. See `capabilities.ts`: without a tier,
     * `users.manage` is a privilege-escalation route — its holder could grant
     * themselves every other capability there is.
     */
    tier: integer("tier").notNull().default(0),

    /** Built by the seeder and not removable, so an institution cannot lock
        itself out by deleting the only role that can administer users. */
    isSystem: boolean("is_system").notNull().default(false),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("roles_tenant_key_idx").on(table.tenantId, table.key),
    uniqueIndex("roles_tenant_id_idx").on(table.tenantId, table.id),
    check("roles_tier_check", sql`${table.tier} between 0 and 2`),
  ],
);

export const roleCapabilities = pgTable(
  "role_capabilities",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
  },
  (table) => [uniqueIndex("role_capability_idx").on(table.roleId, table.capability)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("user_role_idx").on(table.userId, table.roleId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "user_roles_tenant_user_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: "user_roles_tenant_role_fk",
    }).onDelete("cascade"),
    /*
     * Read on every request to resolve the viewer's capabilities, so it is
     * indexed by the column that query starts from. At a couple of thousand
     * concurrent users this is one of the two hottest reads in the system —
     * the other being `session`.
     */
    index("user_roles_user_idx").on(table.userId),
    index("user_roles_tenant_user_idx").on(table.tenantId, table.userId),
  ],
);

/** Exactly one tenant owner: the account allowed to appoint or replace peer
 * administrators. This is tenant data and is protected by RLS. */
export const tenantOwners = pgTable(
  "tenant_owners",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [user.tenantId, user.id],
      name: "tenant_owner_tenant_user_fk",
    }).onDelete("restrict"),
    uniqueIndex("tenant_owner_user_idx").on(table.tenantId, table.userId),
  ],
);
