import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username as usernamePlugin } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { adminDb } from "../src/db/admin.ts";
import * as schema from "../src/db/schema.ts";
import { canonicalPlatformUsername, isValidLocalUsername } from "../src/lib/auth-username.ts";
import { PASSWORD_MINIMUM_LENGTH } from "../src/lib/password-policy.ts";
import { USERNAME_PLUGIN_OPTIONS } from "../src/lib/username-policy.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

function assertLocal(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_ADMIN_URL is not a URL this script can read.");
  }
  if (!LOOPBACK.has(host)) {
    throw new Error("platform:user is restricted to a local development database.");
  }
}

function generatedPassword(): string {
  return randomBytes(18).toString("base64url");
}

function persistLocalCredential(username: string, password: string, signInUrl: string): string {
  const directory = resolve(import.meta.dirname, "..", ".univ", "runtime");
  const target = join(directory, "platform-operator-credentials.txt");
  const temporary = `${target}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    temporary,
    [`username=${username}`, `password=${password}`, `sign_in=${signInUrl}`, ""].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
  return target;
}

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

  const [givenUsername, givenPassword] = process.argv.slice(2);
  const username = (
    givenUsername ??
    process.env.PLATFORM_OPERATOR_USERNAME?.trim() ??
    "developer"
  ).toLowerCase();
  if (!isValidLocalUsername(username)) {
    throw new Error("The platform username must be 3-64 lowercase letters, digits or ._-.");
  }
  const resetExisting = givenPassword !== undefined || process.env.PLATFORM_OPERATOR_RESET === "1";
  const password = givenPassword ?? process.env.PLATFORM_OPERATOR_PASSWORD ?? generatedPassword();

  const authUsername = canonicalPlatformUsername(username);
  const db = adminDb();
  const [existing] = await db
    .select({ id: schema.user.id, tenantId: schema.user.tenantId })
    .from(schema.user)
    .where(eq(schema.user.username, authUsername))
    .limit(1);

  if (existing?.tenantId) {
    throw new Error("This username already belongs to a university account.");
  }

  let userId = existing?.id;
  if (userId) {
    if (resetExisting) {
      if (password.length < PASSWORD_MINIMUM_LENGTH) {
        throw new Error(
          `A password shorter than ${PASSWORD_MINIMUM_LENGTH} characters is refused.`,
        );
      }
      if (/^(?:admin|password|changeme|change-me|replace(?:-with|-me)?)/i.test(password)) {
        throw new Error("The platform operator password is an obvious placeholder.");
      }
      const hash = await issuer.$context.then((context) => context.password.hash(password));
      await db.execute(sql`
        update account set password = ${hash}, updated_at = now()
        where user_id = ${userId} and provider_id = 'credential'
      `);
      await db.delete(schema.session).where(eq(schema.session.userId, userId));
    }
    await db
      .update(schema.user)
      .set({
        name: "اپراتور سامانه",
        displayUsername: username,
        tenantId: null,
        mustChangePassword: false,
      })
      .where(eq(schema.user.id, userId));
  } else {
    if (password.length < PASSWORD_MINIMUM_LENGTH) {
      throw new Error(`A password shorter than ${PASSWORD_MINIMUM_LENGTH} characters is refused.`);
    }
    if (/^(?:admin|password|changeme|change-me|replace(?:-with|-me)?)/i.test(password)) {
      throw new Error("The platform operator password is an obvious placeholder.");
    }
    const result = await issuer.api.signUpEmail({
      body: {
        email: `${authUsername}@users.invalid`,
        password,
        name: "اپراتور سامانه",
        username: authUsername,
      },
    });
    userId = result?.user?.id;
    if (!userId) throw new Error("platform operator account creation returned no id.");
    await db
      .update(schema.user)
      .set({ displayUsername: username, tenantId: null, mustChangePassword: false })
      .where(eq(schema.user.id, userId));
  }

  await db.insert(schema.platformOperators).values({ userId }).onConflictDoNothing();
  const signInUrl = `${process.env.BETTER_AUTH_URL ?? "http://localhost:3020"}/platform/sign-in`;
  console.log(`platform operator ready: ${username}`);
  if (!existing || resetExisting) {
    const credentialFile = persistLocalCredential(username, password, signInUrl);
    console.log(`local credential file: ${credentialFile}`);
  } else {
    console.log("existing credential preserved; no password was changed or printed");
  }
  console.log(`sign in at ${signInUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  });
