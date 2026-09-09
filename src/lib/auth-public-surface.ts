/**
 * Browser/directory-facing Better Auth allow-list.
 *
 * Account administration still goes through audited application Server Actions.
 * Only authentication ceremonies and SCIM protocol ingress are exposed here.
 */
const EXACT = new Map<string, ReadonlySet<string>>([
  ["/api/auth/sign-in/username", new Set(["POST"])],
  ["/api/auth/sign-in/passkey", new Set(["POST"])],
  ["/api/auth/passkey/generate-authenticate-options", new Set(["GET"])],
  ["/api/auth/passkey/add-passkey", new Set(["POST"])],
  ["/api/auth/passkey/list-user-passkeys", new Set(["GET"])],
  ["/api/auth/passkey/delete-passkey", new Set(["POST"])],
  ["/api/auth/passkey/update-passkey", new Set(["POST"])],
  ["/api/auth/sign-in/sso", new Set(["POST"])],
  ["/api/auth/sso/saml2/sp/metadata", new Set(["GET"])],
]);

export function isPublicAuthRequest(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (EXACT.get(pathname)?.has(normalizedMethod)) return true;
  if (pathname.startsWith("/api/auth/sso/callback/"))
    return normalizedMethod === "GET" || normalizedMethod === "POST";
  if (pathname.startsWith("/api/auth/sso/saml2/sp/acs/"))
    return normalizedMethod === "GET" || normalizedMethod === "POST";
  if (pathname === "/api/auth/sso/callback")
    return normalizedMethod === "GET" || normalizedMethod === "POST";
  if (pathname === "/api/auth/scim/v2" || pathname.startsWith("/api/auth/scim/v2/"))
    return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod);
  return false;
}
