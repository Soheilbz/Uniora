import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "@/db/client.ts";
import * as schema from "@/db/schema.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "./password-policy.ts";
import { USERNAME_PLUGIN_OPTIONS } from "./username-policy.ts";

/**
 * The instance that issues an account, and nothing else.
 *
 * ── Why a second instance rather than a call on the first ───────────────────
 *
 * `auth` sets `disableSignUp: true`, deliberately: an open sign-up endpoint on
 * a registry holding national identity numbers is a way to obtain a session.
 * That flag turns the *capability* off, not just the route — `signUpEmail`
 * refuses a server-side call with `EMAIL_PASSWORD_SIGN_UP_DISABLED` as readily
 * as an HTTP one, which is the correct behaviour and was worth discovering
 * before shipping rather than after.
 *
 * So creating an account needs an instance with sign-up enabled. The seeder
 * already does exactly this for the first administrator, and for the same
 * reason: writing the hash by hand would mean this file and the sign-in path
 * agreeing about scrypt parameters forever, and they would diverge the first
 * time the library changed a default — the symptom being a correct password
 * refused at sign-in.
 *
 * ── What makes this safe ────────────────────────────────────────────────────
 *
 * It is never mounted. `auth` is what the route handler exposes; this is a
 * library object reachable only from `createUser`, which begins by requiring
 * `users.manage` and then refuses to assign any role at or above the caller's
 * own tier. The open door is a function in a module, not a path on the server.
 */
export const issuer = betterAuth({
  database: drizzleAdapter(db(), {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: PASSWORD_MINIMUM_LENGTH,
    maxPasswordLength: PASSWORD_MAXIMUM_LENGTH,
  },
  plugins: [username(USERNAME_PLUGIN_OPTIONS)],
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3020",
});
