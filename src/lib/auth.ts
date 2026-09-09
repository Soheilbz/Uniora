import { passkey } from "@better-auth/passkey";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import * as schema from "@/db/schema.ts";
import {
  resolveScimBearer,
  resolveScimProvisionedUser,
} from "@/modules/integrations/scim-credentials.ts";
import {
  isSignInCredentialAttempt,
  isSignInPath,
  recordOutcome,
  shouldRefuse,
} from "./login-guard.ts";
import { recordAuthOutcome } from "./observability/metrics.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "./password-policy.ts";
import { USERNAME_PLUGIN_OPTIONS } from "./username-policy.ts";

/**
 * Who is signed in, on a deployment where several universities share a process.
 *
 * The tables this writes to already exist and already have this exact shape —
 * `src/db/schema/core.ts` and `src/db/schema/enterprise.ts` are the Better Auth
 * bindings. Nothing here invents an identity model; it points the library at
 * the one the institution already has,
 * including `user.tenantId`, which is the thread every request pulls to decide
 * which university's rows it may see.
 */

/**
 * Sessions live in the database, not in this process's memory.
 *
 * The default keeps them per-instance, which is invisible on one machine and
 * wrong the moment there are two: a person signs in against instance A, the
 * load balancer sends their next request to instance B, and they are signed out
 * for no reason they can see. At a couple of thousand concurrent users there is
 * always more than one instance.
 *
 * Postgres rather than Redis for this: the session table is already in the
 * schema, sessions are read far more than written, and one fewer piece of
 * infrastructure for an on-premise university to run is worth more than the
 * microseconds. The rate-limit buckets use PostgreSQL as shared storage as
 * well, so the database remains the source of truth when the web process is
 * scaled horizontally.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db(), {
    provider: "pg",
    transaction: true,
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
      passkey: schema.passkey,
      ssoProvider: schema.ssoProvider,
      // @better-auth/scim 1.7.x models must be registered with the Drizzle
      // adapter as well as declared in the database schema. Without this
      // mapping the plugin model names have no physical table binding.
      scimConnectionBinding: schema.scimConnectionBinding,
      scimIdentityTombstone: schema.scimIdentityTombstone,
      scimSubject: schema.scimSubject,
      scimUser: schema.scimUser,
      scimProjectionGrant: schema.scimProjectionGrant,
      scimGroup: schema.scimGroup,
      scimGroupMember: schema.scimGroupMember,
    },
  }),

  /*
   * Username, not email, because this deployment has no mail server.
   *
   * `emailVerified` is carried in the schema for the library's sake and read by
   * nothing — the comment on that column explains why a check against a flag
   * that can never change is a control in name only. Accounts are issued by an
   * administrator; that is the identity proof this installation actually has.
   */
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: PASSWORD_MINIMUM_LENGTH,
    maxPasswordLength: PASSWORD_MAXIMUM_LENGTH,
    /*
     * Closed, and this is the line that closes it.
     *
     * A university registry holds national identity numbers. An open sign-up
     * endpoint on it is a way for anyone who can reach the port to obtain a
     * session. Accounts come from an administrator who knows who the person is;
     * the seeder builds the first one with its own Better Auth instance, which
     * never serves a request and therefore never exposes this.
     */
    disableSignUp: true,
  },
  plugins: [
    username(USERNAME_PLUGIN_OPTIONS),
    passkey({
      rpID: process.env.BETTER_AUTH_URL
        ? new URL(process.env.BETTER_AUTH_URL).hostname
        : "localhost",
      rpName: process.env.PASSKEY_RP_NAME?.trim() || "University Research Administration",
    }),
    scim({
      connections: [],
      authentication: {
        async verifyBearerToken({ token }) {
          return resolveScimBearer(token);
        },
      },
      identity: {
        async resolveUser(input) {
          const userId = await resolveScimProvisionedUser(
            input.connectionId,
            input.resource.externalId,
          );
          if (!userId) {
            throw new APIError("UNAUTHORIZED", {
              message: "SCIM identity is not pre-provisioned",
              code: "SCIM_IDENTITY_NOT_PROVISIONED",
            });
          }
          return { action: "link" as const, userId, profile: "preserve" as const };
        },
      },
    }) as unknown as BetterAuthPlugin,
    sso({
      disableImplicitSignUp: true,
      saml: {
        algorithms: { onDeprecated: "reject" },
      },
      async resolveUser(input) {
        const result = await db().execute(sql`
          select user_id
          from app.resolve_external_identity(
            ${input.providerId}, ${input.accountKey.issuer}, ${input.accountKey.accountId}
          )
        `);
        const row = result.rows[0] as { user_id?: unknown } | undefined;
        const userId = typeof row?.user_id === "string" ? row.user_id : null;
        return userId
          ? { action: "link" as const, userId, profile: "preserve" as const }
          : { action: "reject" as const, code: "PROVISIONED_IDENTITY_NOT_FOUND" };
      },
    }),
  ],

  /*
   * The address-axis brake, as a backstop rather than the primary defence.
   *
   * The account lockout below answers "this account is being guessed"; nothing
   * else here answers "one address is trying every account". Without it, a
   * credential-stuffing run costs five attempts per account across thousands of
   * accounts and trips nobody's brake. The reverse proxy is the right place for
   * this in production (see the README's deployment notes) — but a control that
   * only exists if an operator remembers to configure nginx is not a control,
   * so the library's limiter runs underneath as well.
   *
   * Generous on purpose: this is an office tool where a whole building shares
   * one NAT address, and the per-account lockout is the precise instrument.
   * Thirty attempts a minute per address stops bulk guessing without locking a
   * floor out of the system.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    storage: "database",
    /**
     * Sign-in paths get their own, tighter budget — and a lockout response must
     * never count against it, or the account-brake above becomes a way to keep
     * refusing somebody after their cooldown expires.
     */
    customRules: {
      /*
       * Keep the address brake aligned with the global 30/minute budget.
       * Account lockout is the precise control for repeated guesses against
       * one identity; a tighter endpoint budget here could turn legitimate
       * sign-ins from one shared office address into a denial of service
       * before that account-level control gets to answer.
       */
      "/sign-in/username": { window: 60, max: 30 },
    },
  },

  user: {
    additionalFields: {
      /*
       * The column that decides which university a request may read.
       *
       * It has to be declared here or Better Auth does not put it in the
       * session: the library returns the fields it knows about, and everything
       * else in the row is invisible to `getSession`. The symptom was a
       * redirect loop rather than a leak, and that ordering is not luck —
       * `requireViewer` treats a session with no tenant as not signed in, so a
       * missing field failed closed. A design that trusted the session and
       * defaulted the tenant would have failed the other way.
       *
       * `input: false` is the security half: without it the field is accepted
       * from a sign-up or update body, and a person could put themselves in
       * another university by naming it in a request. The tenant is assigned by
       * an administrator, never supplied by the account holder.
       */
      tenantId: { type: "string", required: false, input: false },
    },
  },

  session: {
    /*
     * Eight hours: a working day, so nobody is signed out mid-afternoon, and
     * short enough that a machine left unlocked overnight in a shared office
     * is not still signed in the next morning.
     */
    // The tenant-specific ceiling is enforced in `requireViewer`; the library
    // keeps only the platform maximum here so a tenant may choose up to 24 h.
    expiresIn: 60 * 60 * 24,
    updateAge: 60 * 60,
    /*
     * Do not cache the session in a signed browser cookie. This application
     * deliberately checks suspension, revocation and current capabilities from
     * Postgres on every request. A cookie cache would let a revoked or
     * suspended account keep using the application until the cache expired,
     * which is an avoidable authorization window for a registry containing
     * personal and academic records.
     */
    cookieCache: { enabled: false },
  },

  advanced: {
    /*
     * `Secure` and `SameSite=Lax` in production, and neither is negotiable: the
     * session cookie is the whole of a person's access to an institutional
     * registry. Lax rather than Strict so a link mailed between colleagues still
     * lands them signed in; Server Actions carry their own origin check, so the
     * cross-site write path is closed regardless.
     */
    /*
     * The production E2E server intentionally runs on loopback HTTP. Runtime
     * configuration already requires both UNIV_E2E and E2E_EXTERNAL_SERVER for
     * that exception; matching it here keeps WebKit/Firefox from rejecting a
     * __Secure cookie that cannot be valid on an HTTP origin. Real production
     * deployments remain HTTPS-only and keep Secure cookies.
     */
    useSecureCookies:
      process.env.NODE_ENV === "production" &&
      !(process.env.UNIV_E2E === "1" && process.env.E2E_EXTERNAL_SERVER === "1"),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },

  /**
   * The per-account brake on password guessing — see `login-guard.ts`.
   *
   * A pair rather than one hook, because the two halves answer different
   * questions at different moments: `before` decides whether a password may be
   * verified at all, and `after` books what the verification did. Neither can
   * be done from the other's position.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!isSignInPath(ctx.path)) return;
      /* Public credential login is tenant + local username only. Better Auth's
         email endpoint remains enabled as an internal credential primitive but
         is never an accepted HTTP sign-in surface. */
      if (ctx.path === "/sign-in/email") {
        throw new APIError("UNAUTHORIZED", {
          message: "Invalid username or password",
          code: "INVALID_USERNAME_OR_PASSWORD",
        });
      }
      if (await shouldRefuse(ctx.body)) {
        recordAuthOutcome("refused");
        /*
         * The same answer a wrong password gets, deliberately. A distinct
         * «locked» response would make the existence of the account
         * observable, and would tell an attacker exactly when they had
         * succeeded at keeping its owner out.
         */
        throw new APIError("UNAUTHORIZED", {
          message: "Invalid username or password",
          code: "INVALID_USERNAME_OR_PASSWORD",
        });
      }
      const password =
        ctx.body !== null && typeof ctx.body === "object"
          ? (ctx.body as Record<string, unknown>).password
          : undefined;
      /* Better Auth validates the username length, but its username sign-in
         endpoint deliberately does not cap password length before verification.
         Rejecting an oversized value here prevents a request from spending
         scrypt work on an attacker-controlled multi-megabyte string. */
      if (typeof password !== "string" || password.length > PASSWORD_MAXIMUM_LENGTH) {
        throw new APIError("UNAUTHORIZED", {
          message: "Invalid username or password",
          code: "INVALID_USERNAME_OR_PASSWORD",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (!isSignInPath(ctx.path)) return;
      /*
       * Only a rejected credential counts — 401, and nothing else.
       *
       * A malformed body (422), a throttled request (429) and a server fault
       * (500) are all `APIError`s too, and not one of them verified a password.
       * Counting them would mean somebody could cost a colleague their account
       * by sending five broken requests, which is the attack this exists to
       * prevent rather than a way to perform it.
       */
      const returned = ctx.context.returned;
      if (!isSignInCredentialAttempt(ctx.body)) return;
      const rejected = returned instanceof APIError && returned.statusCode === 401;
      const succeeded = returned !== undefined && !(returned instanceof APIError);
      if (rejected || succeeded) {
        recordAuthOutcome(rejected ? "rejected" : "succeeded");
        await recordOutcome(ctx.body, rejected);
      }
    }),
  },

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});

export type Session = typeof auth.$Infer.Session;
