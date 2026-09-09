"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser half of Better Auth.
 *
 * Only sign-in and sign-out use it. Everything else that needs to know who is
 * signed in asks on the server, through `requireViewer` — a client that fetches
 * its own session is a client that renders a page for one person and then
 * corrects it, which on a registry means briefly showing the wrong office.
 *
 * No base URL: the client is served by the same origin as the API, so a
 * relative base is both correct and immune to the deployment moving behind a
 * different hostname.
 */
export const authClient = createAuthClient({
  plugins: [usernameClient(), passkeyClient(), ssoClient()],
});
