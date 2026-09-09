import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username as usernamePlugin } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { adminDb } from "../src/db/admin.ts";
import * as schema from "../src/db/schema.ts";
import { canonicalAuthUsername } from "../src/lib/auth-username.ts";
import { USERNAME_PLUGIN_OPTIONS } from "../src/lib/username-policy.ts";
import { seedCapacity } from "./seed/capacity.ts";
import { seedCouncil } from "./seed/council.ts";
import { seedRecords } from "./seed/records.ts";
import { seedRoles } from "./seed/roles.ts";
import { seedVocabulary } from "./seed/vocabulary.ts";
import { seedWorkshops } from "./seed/workshops.ts";

/**
 * The first university, the first administrator, and enough records for the
 * dashboard's figures to be real rather than fixtures.
 *
 * Safe to run twice. An office restoring a backup and running this again should
 * be told "already there", not given a second copy of itself.
 */

/**
 * A Better Auth instance whose only job is to hash a password correctly.
 *
 * The running application sets `disableSignUp: true`, deliberately — an open
 * sign-up endpoint on a registry holding national identity numbers is a way to
 * obtain a session. But the first account has to come from somewhere, and
 * writing the hash by hand would mean this script and the sign-in path agreeing
 * about scrypt parameters forever. They would diverge the first time the library
 * changed a default, and the symptom would be a correct password being refused.
 *
 * So the seeder builds its own instance with sign-up allowed. It never listens
 * on a port and never handles a request.
 */
const seeder = betterAuth({
  database: drizzleAdapter(adminDb(), {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  plugins: [usernamePlugin(USERNAME_PLUGIN_OPTIONS)],
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3020",
});

const TENANT_SLUG = "univ";
const ADMIN_USERNAME = "admin";
const ADMIN_AUTH_USERNAME = canonicalAuthUsername(TENANT_SLUG, ADMIN_USERNAME);

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD?.trim() ?? "";

function assertSeedPassword(): void {
  if (ADMIN_PASSWORD.length < 12) {
    console.error("SEED_ADMIN_PASSWORD must be set explicitly and contain at least 12 characters.");
    process.exit(1);
  }
  if (/^(?:admin|password|changeme|change-me|replace(?:-with|-me)?)/i.test(ADMIN_PASSWORD)) {
    console.error(
      "SEED_ADMIN_PASSWORD is an obvious placeholder; choose a unique local credential.",
    );
    process.exit(1);
  }
}

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_ADMIN_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    console.error("DATABASE_ADMIN_URL is not set or is not a valid URL.");
    process.exit(1);
  }
  if (host !== "localhost" && host !== "127.0.0.1" && !process.env.SEED_ALLOW_REMOTE) {
    console.error(
      `seeding refuses non-local databases (host: ${host}).\n` +
        "Set SEED_ADMIN_PASSWORD and SEED_ALLOW_REMOTE=1 if this is genuinely intended.",
    );
    process.exit(1);
  }
}

async function main() {
  assertSeedPassword();
  assertLocalDatabase();

  /*
   * The seeder connects as the owning role, because it creates tenants and so
   * cannot be scoped to one. The application's role cannot do any of this: as
   * `univ_app_web`, a statement with no tenant set raises rather than returning
   * an empty result.
   */
  const db = adminDb();

  const found = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG))
    .limit(1);

  let tenantId = found[0]?.id;
  if (!tenantId) {
    // The id is left to PostgreSQL, which generates a uuidv7 — time-ordered, so
    // it lands at the right edge of the index rather than scattering across it.
    const [created] = await db
      .insert(schema.tenants)
      .values({ slug: TENANT_SLUG, name: "دانشگاه نمونه" })
      .returning({ id: schema.tenants.id });
    tenantId = created?.id;
    console.log(`tenant created: ${TENANT_SLUG} (${tenantId})`);
  } else {
    console.log(`tenant already present: ${TENANT_SLUG} (${tenantId})`);
  }

  if (!tenantId) throw new Error("tenant could not be created");

  /*
   * The owner role deliberately does not retain BYPASSRLS. Seeding therefore
   * uses the same explicit tenant boundary as the Web process after the global
   * tenant row has been found/created. adminDb() is a single-connection
   * one-shot pool, so this session-local setting applies to every subsequent
   * tenant-scoped seed query and disappears when the script exits.
   */
  await db.execute(sql`select set_config('app.tenant_id', ${tenantId}, false)`);

  /*
   * The institution profile, beside its tenant.
   *
   * The tenant row is the account the data hangs from; this row is what the
   * letterhead, the certificates and the capacity screen read. `university`
   * stays deliberately unset — the home university is an input only the
   * institution itself can name, and every rule that needs it must say so
   * rather than guess (the capacity screen's «provisional» is exactly this).
   */
  const existingProfile = await db
    .select({ id: schema.institutions.id })
    .from(schema.institutions)
    .where(eq(schema.institutions.tenantId, tenantId))
    .limit(1);
  if (existingProfile[0]) {
    console.log("institution profile already present");
  } else {
    await db.insert(schema.institutions).values({ tenantId, name: "دانشگاه نمونه" });
    console.log("institution profile created");
  }

  const existingAdmin = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, ADMIN_AUTH_USERNAME))
    .limit(1);

  if (existingAdmin[0]) {
    console.log(`administrator already present: ${ADMIN_USERNAME}`);
  } else {
    await seeder.api.signUpEmail({
      body: {
        // A placeholder address: this deployment has no mail server and nothing
        // reads the column. Better Auth requires it, so it is supplied.
        email: `${ADMIN_AUTH_USERNAME}@users.invalid`,
        password: ADMIN_PASSWORD,
        name: "مدیر سامانه",
        username: ADMIN_AUTH_USERNAME,
      },
    });

    /*
     * The tenant is attached afterwards because Better Auth owns the shape of
     * its own insert and drops fields it does not know about. Without this the
     * account exists and can see nothing — `requireViewer` treats a tenant-less
     * session as not signed in, which is correct fail-closed behaviour and a
     * baffling way to discover a seeding bug.
     */
    await db
      .update(schema.user)
      .set({ tenantId, displayUsername: ADMIN_USERNAME, mustChangePassword: false })
      .where(eq(schema.user.username, ADMIN_AUTH_USERNAME));

    console.log(`administrator created: ${ADMIN_USERNAME}`);
  }

  await seedRoles(db, tenantId, ADMIN_AUTH_USERNAME);
  const [administrator] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, ADMIN_AUTH_USERNAME))
    .limit(1);
  if (administrator) {
    await db
      .insert(schema.tenantOwners)
      .values({ tenantId, userId: administrator.id })
      .onConflictDoNothing();
  }
  await seedVocabulary(db, tenantId);
  await seedRecords(db, tenantId);
  await seedCouncil(db, tenantId);
  await seedCapacity(db, tenantId);
  await seedWorkshops(db, tenantId);
  console.log(
    `\nseed complete - sign in at ${process.env.BETTER_AUTH_URL ?? "http://localhost:3020"}/sign-in`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((cause) => {
    console.error(cause);
    process.exit(1);
  });
