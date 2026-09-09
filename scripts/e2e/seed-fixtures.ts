import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username as usernamePlugin } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import { adminDb } from "../../src/db/admin.ts";
import * as schema from "../../src/db/schema.ts";
import { canonicalAuthUsername, canonicalPlatformUsername } from "../../src/lib/auth-username.ts";
import { DEFAULT_TENANT_ROLES } from "../../src/lib/tenant-defaults.ts";
import { USERNAME_PLUGIN_OPTIONS } from "../../src/lib/username-policy.ts";

/**
 * Deterministic fixtures for the E2E suite, written after every provision.
 *
 * Everything here is created into a database that was destroyed and rebuilt
 * moments ago, so there is no idempotency to maintain — only a known shape:
 *
 *   tenant A («univ», the seed's) — full data, three accounts:
 *     admin        full administrator        (the seed's own)
 *     e2e_clerk    research-officer          (may manage records)
 *     e2e_reader   reader                    (may look, may not change)
 *   tenant B («e2e-b») — its own administrator and its own tiny dataset,
 *     deliberately named so no string collides with tenant A's.
 *   tenant C («e2e-platform») — no user session, reserved for platform
 *     lifecycle workflows that intentionally invalidate tenant sessions.
 *
 * The ids the tests need — a student in each tenant, the meeting, the users —
 * are written to `e2e/.state.json`, so a test can aim a URL at a *foreign
 * tenant's* record without hard-coding anything.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/** Fixed credentials, known to the suite. Long enough for the 12-char minimum. */
const USERS = {
  owner: { username: "e2e_owner", password: "e2e_owner-pass-123" },
  clerk: { username: "e2e_clerk", password: "e2e_clerk-pass-123" },
  reader: { username: "e2e_reader", password: "e2e_reader-pass-123" },
  adminB: { username: "e2e_admin_b", password: "e2e_admin_b-pass-123" },
  platform: { username: "e2e_platform", password: "e2e_platform-pass-123" },
  platformSetup: { username: "e2e_platform_setup", password: "e2e_platform_setup-pass-123" },
};

/* Fixed disposable secret used only to exercise the real browser challenge. */
const E2E_PLATFORM_MFA_SECRET = "JBSWY3DPEHPK3PXP";

function encryptFixtureMfaSecret(secret: string): string {
  const configuredKey =
    process.env.MFA_ENCRYPTION_KEY ??
    "1e6c7d8a9b0f1234567890abcdef1234567890abcdef1234567890abcdef1234";
  const key = createHash("sha256").update(configuredKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:legacy:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/** A Better Auth instance over the owning connection, for hashing passwords
 *  exactly the way sign-in verifies them — same as `dev-user.ts`. */
const issuer = betterAuth({
  database: drizzleAdapter(adminDb(), { provider: "pg", schema: schema }),
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  plugins: [usernamePlugin(USERNAME_PLUGIN_OPTIONS)],
  advanced: { disableCSRFCheck: true },
});

const db = adminDb();

async function createUser(
  account: { username: string; password: string },
  tenantId: string,
  roleKey: string,
) {
  const { username, password } = account;
  const [tenant] = await db
    .select({ slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error(`tenant not found for ${username}`);
  const authUsername = canonicalAuthUsername(tenant.slug, username);
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.key, roleKey)))
    .limit(1);
  if (!role) throw new Error(`role "${roleKey}" not found — seed first`);

  const created = await issuer.api.signUpEmail({
    body: {
      name: username,
      email: `${authUsername}@e2e.invalid`,
      password,
      username: authUsername,
    },
  });
  if (!created?.user) throw new Error(`sign-up for ${username} returned nothing`);
  const userId = created.user.id;
  await db
    .update(schema.user)
    .set({ tenantId, displayUsername: username, mustChangePassword: false })
    .where(eq(schema.user.id, userId));
  await db.insert(schema.userRoles).values({ userId, roleId: role.id, tenantId });
  return userId;
}

async function createPlatformUser(account: { username: string; password: string }) {
  const authUsername = canonicalPlatformUsername(account.username);
  const created = await issuer.api.signUpEmail({
    body: {
      name: "E2E Platform Operator",
      email: `${authUsername}@e2e.invalid`,
      password: account.password,
      username: authUsername,
    },
  });
  if (!created?.user) throw new Error("platform E2E sign-up returned nothing");
  const userId = created.user.id;
  await db
    .update(schema.user)
    .set({
      tenantId: null,
      displayUsername: account.username,
      mustChangePassword: false,
      /* The console fixture never decrypts this value: auth.setup marks only
       * this test session as second-factor verified after the real password
       * sign-in. The envelope is valid so a separate browser journey can
       * exercise the production challenge against the real database. */
      mfaEnabled: true,
      mfaSecretEncrypted: encryptFixtureMfaSecret(E2E_PLATFORM_MFA_SECRET),
    })
    .where(eq(schema.user.id, userId));
  await db.insert(schema.platformOperators).values({ userId });
  return userId;
}

async function createPlatformSetupUser(account: { username: string; password: string }) {
  const authUsername = canonicalPlatformUsername(account.username);
  const created = await issuer.api.signUpEmail({
    body: {
      name: "E2E Platform MFA Setup",
      email: `${authUsername}@e2e.invalid`,
      password: account.password,
      username: authUsername,
    },
  });
  if (!created?.user) throw new Error("platform MFA setup sign-up returned nothing");
  const userId = created.user.id;
  await db
    .update(schema.user)
    .set({
      tenantId: null,
      displayUsername: account.username,
      mustChangePassword: false,
      mfaEnabled: false,
      mfaSecretEncrypted: null,
      mfaPendingSecretEncrypted: null,
    })
    .where(eq(schema.user.id, userId));
  await db.insert(schema.platformOperators).values({ userId });
  return userId;
}

// Platform fixture: tenantless by construction, with a real credential account.
const platformUserId = await createPlatformUser(USERS.platform);
const platformSetupUserId = await createPlatformSetupUser(USERS.platformSetup);

// ── Tenant A accounts (the seed's tenant, slug «univ») ────────────────────
const [tenantA] = await db
  .select({ id: schema.tenants.id })
  .from(schema.tenants)
  .where(eq(schema.tenants.slug, "univ"))
  .limit(1);
if (!tenantA) throw new Error("tenant «univ» not found — seed first");
/* The fixture intentionally uses the owning connection, but FORCE RLS still
 * applies to tenant-owned tables. Keep the same explicit context discipline as
 * the request-serving application instead of weakening the E2E database policy. */
await db.execute(sql`select set_config('app.tenant_id', ${tenantA.id}, false)`);
await db
  .update(schema.institutions)
  .set({ requireAdminMfa: false })
  .where(eq(schema.institutions.tenantId, tenantA.id));

/* The route-surface suite is an integrated product check, not a smoke test of
 * the not-found boundary. Enable the optional modules for its disposable
 * tenant so their real pages, actions, and accessibility contracts are
 * exercised while production tenants still keep the catalogue defaults. */
await db
  .insert(schema.tenantFeatures)
  .values([
    { tenantId: tenantA.id, feature: "correspondence", enabled: true },
    { tenantId: tenantA.id, feature: "research-projects", enabled: true },
  ])
  .onConflictDoUpdate({
    target: [schema.tenantFeatures.tenantId, schema.tenantFeatures.feature],
    set: { enabled: true, updatedAt: new Date() },
  });

/* Keep the owner invariant without forcing an interactive E2E account through
 * MFA. This technical owner never receives a storage state or opens a page;
 * the accounts below exercise the application as ordinary authenticated users.
 */
const ownerId = await createUser(USERS.owner, tenantA.id, "administrator");
const clerkId = await createUser(USERS.clerk, tenantA.id, "research-officer");
const readerId = await createUser(USERS.reader, tenantA.id, "reader");
/* The owner is a disposable logout-only fixture. Tenant owners use the same
 * password-only flow as every other university account; platform MFA remains
 * covered by the separate tenantless operator fixtures above. */
await db.delete(schema.tenantOwners).where(eq(schema.tenantOwners.tenantId, tenantA.id));
await db.insert(schema.tenantOwners).values({ tenantId: tenantA.id, userId: ownerId });

// A known student in tenant A, distinct from the seed cohort by name and number.
const [studentA] = await db
  .insert(schema.students)
  .values({
    tenantId: tenantA.id,
    studentNumber: "403000001",
    nationalId: "0123456789",
    firstName: "آزمون",
    lastName: "پایان‌بهار",
    degree: "master",
    status: "enrolled",
    admissionDate: "2025-09-23",
    version: 1,
  })
  .returning({ id: schema.students.id });
if (!studentA) throw new Error("studentA insert returned nothing");

// ── Tenant B: its own university, its own everything ──────────────────────
const [tenantB] = await db
  .insert(schema.tenants)
  .values({
    slug: "e2e-b",
    name: "دانشگاه دوم آزمون",
    status: "active",
    provisioningStatus: "active",
  })
  .returning({ id: schema.tenants.id });
if (!tenantB) throw new Error("tenantB insert returned nothing");
await db.execute(sql`select set_config('app.tenant_id', ${tenantB.id}, false)`);

// Tenant B uses the same administrator definition as every provisioned university.
const adminDefinition = DEFAULT_TENANT_ROLES.find((role) => role.key === "administrator");
if (!adminDefinition) throw new Error("administrator role definition missing");
const [roleB] = await db
  .insert(schema.roles)
  .values({
    tenantId: tenantB.id,
    key: adminDefinition.key,
    name: "مدیر دانشگاه دوم",
    tier: adminDefinition.tier,
    isSystem: true,
  })
  .returning({ id: schema.roles.id });
if (!roleB) throw new Error("roleB insert returned nothing");
await db
  .insert(schema.roleCapabilities)
  .values(adminDefinition.capabilities.map((capability) => ({ roleId: roleB.id, capability })));
await db.insert(schema.institutions).values({
  tenantId: tenantB.id,
  name: "دانشگاه دوم آزمون",
  faculty: "دانشکده آزمون",
  requireAdminMfa: false,
});

/* Keep the interactive B administrator out of the owner-only MFA workflow,
 * just as tenant A's browser fixtures are kept out of it. The owner invariant
 * is still real: a separate technical owner carries it without opening a page. */
const ownerBId = await createUser(
  { username: "e2e_owner_b", password: "e2e_owner_b-pass-123" },
  tenantB.id,
  "administrator",
);
const adminBId = await createUser(USERS.adminB, tenantB.id, "administrator");
await db.insert(schema.tenantOwners).values({ tenantId: tenantB.id, userId: ownerBId });

// Tenant B's own professor and student — same *shape* as A's, different people.
const [professorB] = await db
  .insert(schema.professors)
  .values({
    tenantId: tenantB.id,
    professorCode: "B-100",
    firstName: "استاد",
    lastName: "دانشگاه‌دوم",
    status: "active",
    version: 1,
  })
  .returning({ id: schema.professors.id });
if (!professorB) throw new Error("professorB insert returned nothing");

const [studentB] = await db
  .insert(schema.students)
  .values({
    tenantId: tenantB.id,
    studentNumber: "903000001",
    nationalId: "9876543210",
    firstName: "دانشجوی",
    lastName: "دانشگاه‌دوم",
    degree: "master",
    status: "enrolled",
    version: 1,
  })
  .returning({ id: schema.students.id });
if (!studentB) throw new Error("studentB insert returned nothing");

// Tenant C is reserved for platform lifecycle workflows. It has no browser
// session of its own, so suspend/resume tests cannot invalidate the sessions
// used by the tenant-isolation suite for tenant B.
const [platformTenant] = await db
  .insert(schema.tenants)
  .values({
    slug: "e2e-platform",
    name: "دانشگاه آزمون عملیات پلتفرم",
    status: "active",
    provisioningStatus: "active",
  })
  .returning({ id: schema.tenants.id });
if (!platformTenant) throw new Error("platformTenant insert returned nothing");

/* The remaining records are intentionally tenant A's print/capacity fixtures. */
await db.execute(sql`select set_config('app.tenant_id', ${tenantA.id}, false)`);

// A council meeting in tenant A, for the isolation tests to be refused at.
const [meetingA] = await db
  .insert(schema.councilMeetings)
  .values({
    tenantId: tenantA.id,
    meetingNumber: "990",
    meetingDate: "2026-06-01",
    version: 1,
  })
  .returning({ id: schema.councilMeetings.id });
if (!meetingA) throw new Error("meetingA insert returned nothing");

// Two complete-enough council decisions, one per worksheet stage. They let the
// browser exercise the real print route for all fourteen A4 forms rather than
// relying only on component-level golden tests.
const commonDecision = {
  tenantId: tenantA.id,
  meetingId: meetingA.id,
  meetingNumber: "990",
  meetingDate: "2026-06-01",
  studentId: studentA.id,
  studentNumber: "403000001",
  studentName: "آزمون پایان‌بهار",
  educationLevel: "master",
  fieldOfStudy: "اقتصاد کشاورزی",
  thesisTitle: "عنوان پایان‌نامه آزمون چاپ",
  primarySupervisor: "دکتر راهنما",
  reviewer1: "دکتر داور یک",
  reviewer2: "دکتر داور دو",
  facultyDean: "دکتر رئیس دانشکده",
  departmentHead: "دکتر مدیر گروه",
  groupManager: "دکتر مدیر گروه",
  researchDeputy: "دکتر معاون پژوهشی",
  version: 1,
};
const [proposalDecisionA] = await db
  .insert(schema.councilDecisions)
  .values({
    ...commonDecision,
    thesisCode: "E2E-PRINT-PROPOSAL",
    reportCategory: "proposal",
    proposalDefenseDate: "2026-06-15",
    decisionText: "تصویب پروپوزال برای آزمون چاپ",
  })
  .returning({ id: schema.councilDecisions.id });
if (!proposalDecisionA) throw new Error("proposalDecisionA insert returned nothing");

const [finalDecisionA] = await db
  .insert(schema.councilDecisions)
  .values({
    ...commonDecision,
    thesisCode: "E2E-PRINT-FINAL",
    reportCategory: "final_defense",
    defenseMeetingDate: "2026-07-01",
    defenseMeetingTime: "10:00",
    defenseMeetingLocation: "سالن دفاع",
    decisionText: "صدور مجوز دفاع نهایی برای آزمون چاپ",
  })
  .returning({ id: schema.councilDecisions.id });
if (!finalDecisionA) throw new Error("finalDecisionA insert returned nothing");

// A workshop in tenant A with capacity 1, for the capacity-refusal import test.
const [workshopA] = await db
  .insert(schema.workshops)
  .values({
    tenantId: tenantA.id,
    title: "کارگاه آزمون ظرفیت",
    workshopDate: "2026-10-01",
    capacity: 1,
    status: "planned",
    version: 1,
  })
  .returning({ id: schema.workshops.id });
if (!workshopA) throw new Error("workshopA insert returned nothing");

const state = {
  builtAt: new Date().toISOString(),
  run: randomUUID().slice(0, 8),
  tenantA: {
    slug: "univ",
    admin: { username: "admin", password: "e2e-admin-pass-123" },
    users: {
      owner: USERS.owner,
      clerk: USERS.clerk,
      reader: USERS.reader,
      ids: { ownerId, clerkId, readerId },
    },
    studentId: studentA.id,
    studentNumber: "403000001",
    studentName: "آزمون پایان‌بهار",
    meetingId: meetingA.id,
    meetingNumber: "990",
    proposalDecisionId: proposalDecisionA.id,
    finalDecisionId: finalDecisionA.id,
    workshopId: workshopA.id,
    workshopTitle: "کارگاه آزمون ظرفیت",
  },
  tenantB: {
    slug: "e2e-b",
    admin: USERS.adminB,
    adminId: adminBId,
    studentId: studentB.id,
    professorId: professorB.id,
    studentNumber: "903000001",
  },
  platform: {
    ...USERS.platform,
    userId: platformUserId,
    mfaSecret: E2E_PLATFORM_MFA_SECRET,
  },
  platformSetup: { ...USERS.platformSetup, userId: platformSetupUserId },
};

/* One state file per parallel group — the ids inside are per-database. */
const stateFile = process.env.E2E_STATE_FILE ?? "e2e/.state.json";
writeFileSync(
  isAbsolute(stateFile) ? stateFile : join(root, stateFile),
  JSON.stringify(state, null, 2),
);
console.log(`fixtures written: ${stateFile}`);
