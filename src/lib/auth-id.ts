/**
 * Validate an opaque Better Auth identifier before it is accepted from a form.
 *
 * Better Auth owns the format of its text primary keys. In the current 1.7
 * configuration it generates 32-character base62 ids; older installs may have
 * UUID-shaped values. Do not reuse the application's UUID validator here: that
 * would reject Better Auth's own default identifiers.
 *
 * The database comparison is parameterised, so this is primarily a size/shape
 * boundary for untrusted form input rather than an SQL-injection control.
 */
const AUTH_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isAuthId(value: string): boolean {
  return AUTH_ID_PATTERN.test(value);
}
