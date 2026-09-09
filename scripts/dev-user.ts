import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username as usernamePlugin } from "better-auth/plugins";
import { and, eq, sql } from "drizzle-orm";
import { adminDb } from "../src/db/admin.ts";
import * as schema from "../src/db/schema.ts";
import { canonicalAuthUsername } from "../src/lib/auth-username.ts";
import { PASSWORD_MINIMUM_LENGTH } from "../src/lib/password-policy.ts";
import {
  isValidUsernameCharacters,
  USERNAME_MAXIMUM_LENGTH,
  USERNAME_MINIMUM_LENGTH,
  USERNAME_PLUGIN_OPTIONS,
} from "../src/lib/username-policy.ts";

/**
 * A local workstation administrator account for application development.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * `pnpm seed` creates one administrator, and that account is the institution's:
 * it is the one an office would actually sign in as. Working on the software
 * means signing in and out repeatedly, resetting passwords, and occasionally
 * leaving an account in a state nobody wants the institution's own to be left
 * in. So a workstation developer gets a disposable local administrator, created here rather than
 * by hand in SQL — a password written directly into `account` is a password the
 * sign-in path will refuse, because the hash has to come from the same library
 * with the same parameters.
 *
 * Idempotent: run twice and the second run resets the password rather than
 * failing on the unique index, which is what somebody who has lost it wants.
 *
 * ── Why it refuses to run anywhere but here ─────────────────────────────────
 *
 * This mints an account holding every capability there is, including
 * `users.manage`, from a shell with no authentication in front of it. That is
 * correct for a workstation and catastrophic anywhere else, and the difference
 * between the two is one environment variable somebody exported an hour ago and
 * forgot. So the host is checked, and a database that is not on this machine is
 * refused outright rather than warned about.
 *
 *   pnpm dev:user                       # deterministic default, printed
 *   pnpm dev:user alireza               # that username, generated password
 *   pnpm dev:user alireza my-passphrase # both given
 */

const DEFAULT_USERNAME = "dev";
const TENANT_SLUG = "univ";

/** The role the seeder gives the administrator — the top tier. */
const LOCAL_ADMIN_ROLE_KEY = "administrator";

/**
 * Local only, and «local» means the loopback address.
 *
 * A hostname that merely *looks* local is not enough — `localhost` can be
 * pointed anywhere in a hosts file — but the loopback literals cannot leave the
 * machine, so they are the honest test. Anything else is refused.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

function assertLocal(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_ADMIN_URL is not a URL this script can read.");
  }

  if (!LOOPBACK.has(host)) {
    throw new Error(
      `Refusing to create a full-privilege account against ${host}.\n` +
        "This script is for a development workstation. To create an account on a real\n" +
        "deployment, sign in as an administrator and use the users screen, which checks\n" +
        "the caller's capability and refuses to grant a role at or above their own tier.",
    );
  }
}

/**
 * A password worth the account's privileges.
 *
 * Generated rather than defaulted, because a fixed workstation-admin password is
 * the same privileged password on every machine that ever ran this — including one
 * that later gets a port forwarded to it. Base64url of 18 random bytes is 24
 * characters and safe to paste anywhere.
 */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * An instance whose only job is to hash a password the way sign-in expects.
 *
 * The application sets `disableSignUp: true` deliberately, and that turns the
 * capability off rather than only the route — `signUpEmail` refuses a
 * server-side call as readily as an HTTP one. The seeder builds its own
 * instance for exactly this reason and this is the same argument: writing the
 * hash by hand would mean this file and the sign-in path agreeing about scrypt
 * parameters forever, and the symptom of their diverging is a correct password
 * being refused.
 *
 * It never listens on a port and never handles a request.
 */
const issuer = betterAuth({
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

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is not set.");
  assertLocal(adminUrl);

  const [givenName, givenPassword] = process.argv.slice(2);
  const account = (givenName ?? DEFAULT_USERNAME).trim().toLowerCase();
  const authUsername = canonicalAuthUsername(TENANT_SLUG, account);
  const password = givenPassword ?? generatePassword();

  if (
    account.length < USERNAME_MINIMUM_LENGTH ||
    account.length > USERNAME_MAXIMUM_LENGTH ||
    !isValidUsernameCharacters(account)
  ) {
    throw new Error(
      `«${account}» is not a username this application accepts: 3-64 lowercase letters, digits, dots, underscores or hyphens.`,
    );
  }
  if (password.length < PASSWORD_MINIMUM_LENGTH) {
    throw new Error(`A password shorter than ${PASSWORD_MINIMUM_LENGTH} characters is refused.`);
  }

  /*
   * The owning role, because this reads and writes across tenants to find the
   * one it is seeding into. The application's role could not: as
   * `univ_app_web`, a statement with no tenant set raises rather than returning
   * an empty result.
   */
  const db = adminDb();

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG))
    .limit(1);
  if (!tenant) throw new Error(`No «${TENANT_SLUG}» institution on file. Run pnpm seed first.`);

  const [role] = await db
    .select({ id: schema.roles.id, name: schema.roles.name })
    .from(schema.roles)
    .where(and(eq(schema.roles.tenantId, tenant.id), eq(schema.roles.key, LOCAL_ADMIN_ROLE_KEY)))
    .limit(1);
  if (!role) throw new Error(`No «${LOCAL_ADMIN_ROLE_KEY}» role on file. Run pnpm seed first.`);

  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, authUsername))
    .limit(1);

  if (existing) {
    /*
     * The same path the users screen resets a password by.
     *
     * `setPassword` needs the target's session and there is none here, so the
     * hash comes from `$context.password.hash` — the very function the sign-in
     * path verifies against. The credential this writes is indistinguishable
     * from one the library wrote itself, and stays correct if the algorithm is
     * ever changed, because there is only one place it is defined.
     */
    const hash = await issuer.$context.then((context) => context.password.hash(password));
    await db.execute(sql`
      update account set password = ${hash}, updated_at = now()
      where user_id = ${existing.id} and provider_id = 'credential'`);

    /* Every session ends. A reset that left the old ones alive would not close
       the thing a reset is usually being run to close. */
    await db.delete(schema.session).where(eq(schema.session.userId, existing.id));

    console.log(`password reset: ${account}`);
  } else {
    await issuer.api.signUpEmail({
      body: {
        // A placeholder address: this deployment has no mail server and nothing
        // reads the column. Better Auth requires it, so it is supplied.
        email: `${authUsername}@users.invalid`,
        password,
        name: "مدیر توسعه محلی",
        username: authUsername,
      },
    });
    console.log(`account created: ${account}`);
  }

  const [created] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.username, authUsername))
    .limit(1);
  if (!created) throw new Error("The account was not written.");

  /*
   * The tenant is attached afterwards because Better Auth owns the shape of its
   * own insert and drops fields it does not know about. Without this the
   * account exists and can see nothing — `requireViewer` treats a tenant-less
   * session as not signed in, which is correct fail-closed behaviour and a
   * baffling way to discover a provisioning bug.
   */
  await db
    .update(schema.user)
    .set({ tenantId: tenant.id, displayUsername: account, mustChangePassword: false })
    .where(eq(schema.user.id, created.id));

  const [held] = await db
    .select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, created.id), eq(schema.userRoles.roleId, role.id)))
    .limit(1);

  if (!held) {
    await db
      .insert(schema.userRoles)
      .values({ userId: created.id, roleId: role.id, tenantId: tenant.id });
  }

  console.log("");
  console.log(`  username  ${account}`);
  console.log(`  password  ${password}`);
  console.log(`  role      ${role.name}`);
  console.log("");
  console.log(`sign in at ${process.env.BETTER_AUTH_URL ?? "http://localhost:3020"}/sign-in`);
}

main()
  .then(() => process.exit(0))
  .catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  });
