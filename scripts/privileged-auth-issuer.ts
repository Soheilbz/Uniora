import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { platformDb } from "../src/db/platform.ts";
import * as schema from "../src/db/schema.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "../src/lib/password-policy.ts";
import { USERNAME_PLUGIN_OPTIONS } from "../src/lib/username-policy.ts";

/** Worker-only Better Auth issuer. Web requests must use src/lib/auth-issue.ts. */
export const privilegedIssuer = betterAuth({
  database: drizzleAdapter(platformDb(), {
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
